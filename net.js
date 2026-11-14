/* ── 지렁이 대작전 온라인 멀티플레이어 네트워크 모듈 (WebRTC P2P 기반) ── */
(function (root) {
  'use strict';

  var PEER_PREFIX = 'jirunge-v1-';
  var PEER_CONFIG = {
    debug: 1,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ]
    }
  };

  var Net = {
    isOnline: false,
    isHost: false,
    isGuest: false,
    roomCode: '',
    myWormId: 0,
    peer: null,
    hostConn: null,
    guestConns: {}, // peerId -> DataConnection
    guestWorms: {}, // peerId -> wormId
    lastBroadcast: 0,
    onStateUpdate: null,
    onGuestJoin: null,
    onGuestLeave: null,

    // 무작위 6자리 방 코드 생성
    genRoomCode: function () {
      var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      var res = '';
      for (var i = 0; i < 6; i++) res += chars[(Math.random() * chars.length) | 0];
      return res;
    },

    // 방 만들기 (호스트)
    createRoom: function (code, callbacks) {
      this.close();
      this.isOnline = true;
      this.isHost = true;
      this.isGuest = false;
      this.roomCode = (code || this.genRoomCode()).toUpperCase();
      this.guestConns = {};
      this.guestWorms = {};

      var self = this;
      var peerId = PEER_PREFIX + this.roomCode;
      
      try {
        this.peer = new Peer(peerId, PEER_CONFIG);
      } catch (e) {
        if (callbacks && callbacks.onError) callbacks.onError(e);
        return;
      }

      this.peer.on('open', function (id) {
        if (callbacks && callbacks.onOpen) callbacks.onOpen(self.roomCode);
      });

      this.peer.on('connection', function (conn) {
        self.guestConns[conn.peer] = conn;

        conn.on('open', function () {
          // 게스트 연결 완료 대기
        });

        conn.on('data', function (data) {
          if (!data || !data.t) return;
          if (data.t === 'join') {
            if (callbacks && callbacks.onGuestJoin) {
              var wId = callbacks.onGuestJoin(conn.peer, data.name, data.skin);
              self.guestWorms[conn.peer] = wId;
              var initSnap = callbacks.getInitialSnapshot ? callbacks.getInitialSnapshot() : null;
              conn.send({
                t: 'init',
                roomCode: self.roomCode,
                myId: wId,
                s: initSnap
              });
            }
          } else if (data.t === 'input') {
            if (callbacks && callbacks.onGuestInput) {
              callbacks.onGuestInput(conn.peer, data.a, data.boost);
            }
          } else if (data.t === 'skill') {
            if (callbacks && callbacks.onGuestSkill) {
              callbacks.onGuestSkill(conn.peer, data.skill);
            }
          } else if (data.t === 'respawn') {
            if (callbacks && callbacks.onGuestRespawn) {
              var newId = callbacks.onGuestRespawn(conn.peer);
              self.guestWorms[conn.peer] = newId;
              var respawnSnap = callbacks.getInitialSnapshot ? callbacks.getInitialSnapshot() : null;
              conn.send({ t: 'respawned', myId: newId, s: respawnSnap });
            }
          }
        });

        conn.on('close', function () {
          var wId = self.guestWorms[conn.peer];
          delete self.guestConns[conn.peer];
          delete self.guestWorms[conn.peer];
          if (callbacks && callbacks.onGuestLeave) callbacks.onGuestLeave(conn.peer, wId);
        });

        conn.on('error', function (err) {
          console.warn('[Net] Guest conn error:', err);
        });
      });

      this.peer.on('error', function (err) {
        console.warn('[Net] Peer error:', err);
        if (err.type === 'unavailable-id') {
          // 이미 방이 존재할 경우 새 코드 생성
          self.createRoom(null, callbacks);
        } else if (callbacks && callbacks.onError) {
          callbacks.onError(err);
        }
      });
    },

    // 방 참가하기 (게스트)
    joinRoom: function (code, nick, skin, callbacks) {
      this.close();
      this.isOnline = true;
      this.isHost = false;
      this.isGuest = true;
      this.roomCode = (code || '').toUpperCase().trim();

      var self = this;
      try {
        this.peer = new Peer(null, PEER_CONFIG);
      } catch (e) {
        if (callbacks && callbacks.onError) callbacks.onError(e);
        return;
      }

      this.peer.on('open', function () {
        var hostPeerId = PEER_PREFIX + self.roomCode;
        var conn = self.peer.connect(hostPeerId, { reliable: true });
        self.hostConn = conn;

        conn.on('open', function () {
          conn.send({
            t: 'join',
            name: nick || '참가자',
            skin: skin || 'grass'
          });
        });

        conn.on('data', function (data) {
          if (!data || !data.t) return;
          if (data.t === 'init') {
            self.myWormId = data.myId;
            if (data.s && callbacks && callbacks.onSnapshot) {
              callbacks.onSnapshot({ t: 'sync', s: data.s });
            }
            if (callbacks && callbacks.onJoined) callbacks.onJoined(data);
          } else if (data.t === 'sync') {
            if (callbacks && callbacks.onSnapshot) callbacks.onSnapshot(data);
          } else if (data.t === 'respawned') {
            self.myWormId = data.myId;
            if (data.s && callbacks && callbacks.onSnapshot) {
              callbacks.onSnapshot({ t: 'sync', s: data.s });
            }
            if (callbacks && callbacks.onRespawned) callbacks.onRespawned(data.myId);
          }
        });

        conn.on('close', function () {
          if (callbacks && callbacks.onDisconnect) callbacks.onDisconnect('방장과 연결이 종료되었습니다.');
          self.close();
        });

        conn.on('error', function (err) {
          if (callbacks && callbacks.onError) callbacks.onError(err);
        });
      });

      this.peer.on('error', function (err) {
        console.warn('[Net] Join error:', err);
        if (callbacks && callbacks.onError) callbacks.onError(err);
      });
    },

    // 호스트가 모든 게스트에게 월드 스냅샷 전송
    broadcastSnapshot: function (snapshot) {
      if (!this.isHost || !this.guestConns) return;
      var msg = { t: 'sync', s: snapshot };
      for (var peerId in this.guestConns) {
        var conn = this.guestConns[peerId];
        if (conn && conn.open) {
          try { conn.send(msg); } catch (e) {}
        }
      }
    },

    // 게스트가 호스트에게 입력 전송
    sendInput: function (angle, isBoost) {
      if (!this.isGuest || !this.hostConn || !this.hostConn.open) return;
      try {
        this.hostConn.send({ t: 'input', a: angle, boost: !!isBoost });
      } catch (e) {}
    },

    // 게스트가 호스트에게 스킬 사용 전송
    sendSkill: function (skillName) {
      if (!this.isGuest || !this.hostConn || !this.hostConn.open) return;
      try {
        this.hostConn.send({ t: 'skill', skill: skillName });
      } catch (e) {}
    },

    // 게스트가 부활 요청 전송
    requestRespawn: function () {
      if (!this.isGuest || !this.hostConn || !this.hostConn.open) return;
      try {
        this.hostConn.send({ t: 'respawn' });
      } catch (e) {}
    },

    // 접속 인원 수 계산
    getPlayerCount: function () {
      var count = 1;
      if (this.isHost && this.guestConns) {
        for (var k in this.guestConns) {
          if (this.guestConns[k] && this.guestConns[k].open) count++;
        }
      }
      return count;
    },

    // 초대 링크 복사
    getInviteUrl: function (code) {
      var c = code || this.roomCode;
      var url = window.location.origin + window.location.pathname + '?room=' + encodeURIComponent(c);
      return url;
    },

    leaveRoom: function () {
      this.close();
    },

    close: function () {
      this.isOnline = false;
      this.isHost = false;
      this.isGuest = false;
      this.roomCode = '';
      this.myWormId = 0;
      if (this.hostConn) {
        try { this.hostConn.close(); } catch (e) {}
        this.hostConn = null;
      }
      for (var k in this.guestConns) {
        try { this.guestConns[k].close(); } catch (e) {}
      }
      this.guestConns = {};
      this.guestWorms = {};
      if (this.peer) {
        try { this.peer.destroy(); } catch (e) {}
        this.peer = null;
      }
    }
  };

  root.WormNet = Net;
})(typeof window !== 'undefined' ? window : this);
