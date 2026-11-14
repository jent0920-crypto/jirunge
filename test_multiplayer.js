const assert = require('assert');
const C = require('./core.js');

console.log('Testing multiplayer core functions...');

// 1. New game
const G = C.newGame({ bots: 5, player: true, name: '호스트', skin: 'sprout' });
assert.strictEqual(G.worms.length, 6);
assert.strictEqual(G.player.name, '호스트');

// 2. Spawn guest worm
const guest1 = C.spawnGuestWorm(G, '게스트1', 'tiger');
assert.strictEqual(G.worms.length, 7);
assert.strictEqual(guest1.name, '게스트1');
assert.strictEqual(guest1.isGuest, true);
assert.strictEqual(G.byId[guest1.id], guest1);

// 3. Serialize snapshot
const snapshot = C.serializeSnapshot(G);
assert(Array.isArray(snapshot.worms));
assert.strictEqual(snapshot.worms.length, 7);
assert.strictEqual(snapshot.tick, G.tick);

// 4. Client dummy game applying snapshot
const clientG = C.newGame({ bots: 0, player: false });
assert.strictEqual(clientG.worms.length, 0);

C.applySnapshot(clientG, snapshot);
assert.strictEqual(clientG.worms.length, 7);
const clientGuestWorm = clientG.byId[guest1.id];
assert(clientGuestWorm, 'Guest worm must be present on client');
assert.strictEqual(clientGuestWorm.name, '게스트1');
assert.strictEqual(clientGuestWorm.skin.id, 'tiger');

// 5. Test skill usage with remote guest worm
guest1.durians = 2;
const durianOk = C.useDurian(G, guest1);
assert.strictEqual(durianOk, true);
assert.strictEqual(guest1.durians, 1);

guest1.bananas = 2;
const bananaOk = C.useBanana(G, guest1);
assert.strictEqual(bananaOk, true);
assert.strictEqual(guest1.bananas, 1);

guest1.appleJellies = 2;
const jellyOk = C.useAppleJelly(G, guest1);
assert.strictEqual(jellyOk, true);
assert.strictEqual(guest1.appleJellies, 1);
assert.strictEqual(guest1.jumpTimer, 1.0);

console.log('All multiplayer core tests passed successfully!');
