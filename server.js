const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Game state storage (in-memory, resets on server restart)
const games = new Map();

// Role descriptions
const ROLE_INFO = {
    // Townsfolk
    "Washerwoman": {
        team: "good",
        type: "Townsfolk",
        ability: "You start knowing that 1 of 2 players is a particular Townsfolk.",
        tips: "Share your information carefully. One of the two players you learned about is the role you were shown."
    },
    "Librarian": {
        team: "good",
        type: "Townsfolk",
        ability: "You start knowing that 1 of 2 players is a particular Outsider. (Or that zero are in play.)",
        tips: "Your information helps identify Outsiders, which can be valuable for finding the Drunk or confirming claims."
    },
    "Investigator": {
        team: "good",
        type: "Townsfolk",
        ability: "You start knowing that 1 of 2 players is a particular Minion.",
        tips: "You know one of two players is evil! Be strategic about when and how you share this information."
    },
    "Chef": {
        team: "good",
        type: "Townsfolk",
        ability: "You start knowing how many pairs of evil players there are.",
        tips: "Pairs means adjacent evil players in the seating order. Zero pairs means no evil players are sitting next to each other."
    },
    "Empath": {
        team: "good",
        type: "Townsfolk",
        ability: "Each night, you learn how many of your 2 alive neighbours are evil.",
        tips: "Your information updates each night. If neighbors die, you get info about new neighbors. Track changes carefully."
    },
    "Fortune Teller": {
        team: "good",
        type: "Townsfolk",
        ability: "Each night, choose 2 players: you learn if either is a Demon. There is a good player that registers as a Demon to you.",
        tips: "One good player will always show as the Demon to you - the 'Red Herring'. Use process of elimination."
    },
    "Undertaker": {
        team: "good",
        type: "Townsfolk",
        ability: "Each night*, you learn which character died by execution today.",
        tips: "You learn the TRUE role, even if they were the Drunk or poisoned. Very powerful for confirming claims."
    },
    "Monk": {
        team: "good",
        type: "Townsfolk",
        ability: "Each night*, choose a player (not yourself): they are safe from the Demon tonight.",
        tips: "Protect key players but don't be predictable. You cannot protect yourself."
    },
    "Ravenkeeper": {
        team: "good",
        type: "Townsfolk",
        ability: "If you die at night, you are woken to choose a player: you learn their character.",
        tips: "You only get info if you die at NIGHT (not execution). Choose someone suspicious to confirm or deny their claim."
    },
    "Virgin": {
        team: "good",
        type: "Townsfolk",
        ability: "The 1st time you are nominated, if the nominator is a Townsfolk, they are executed immediately.",
        tips: "Get nominated by someone you trust to confirm them as Townsfolk. This only works ONCE."
    },
    "Slayer": {
        team: "good",
        type: "Townsfolk",
        ability: "Once per game, during the day, publicly choose a player: if they are the Demon, they die.",
        tips: "You only get ONE shot. Make it count! Use it when you're confident, or to test a strong suspicion."
    },
    "Soldier": {
        team: "good",
        type: "Townsfolk",
        ability: "You are safe from the Demon.",
        tips: "The Demon cannot kill you at night. You can be executed or die from other effects though. Use this to be bold!"
    },
    "Mayor": {
        team: "good",
        type: "Townsfolk",
        ability: "If only 3 players live & no execution occurs, your team wins. If you die at night, another player might die instead.",
        tips: "In the final 3, convince town not to execute. Your night death might bounce to another player (Storyteller's choice)."
    },
    // Outsiders
    "Butler": {
        team: "good",
        type: "Outsider",
        ability: "Each night, choose a player (not yourself): tomorrow, you may only vote if they are voting too.",
        tips: "You MUST choose a master each night. You can only raise your hand to vote when your master's hand is raised."
    },
    "Drunk": {
        team: "good",
        type: "Outsider",
        ability: "You do not know you are the Drunk. You think you are a Townsfolk character, but you are not.",
        tips: "If you're reading this, you ARE the Drunk. Your Townsfolk ability doesn't work. Your info may be wrong."
    },
    "Recluse": {
        team: "good",
        type: "Outsider",
        ability: "You might register as evil & as a Minion or Demon, even if dead.",
        tips: "Other players' abilities might see you as evil. This can cause chaos - be prepared to be suspected!"
    },
    "Saint": {
        team: "good",
        type: "Outsider",
        ability: "If you die by execution, your team loses.",
        tips: "Do NOT get executed! Convince town you're good. If evil knows you're the Saint, they may try to get you killed."
    },
    // Minions
    "Poisoner": {
        team: "evil",
        type: "Minion",
        ability: "Each night, choose a player: they are poisoned tonight and tomorrow day.",
        tips: "Poison key information roles to corrupt their data. The poisoned player doesn't know they're poisoned."
    },
    "Spy": {
        team: "evil",
        type: "Minion",
        ability: "Each night, you see the Grimoire. You might register as good & as a Townsfolk or Outsider, even if dead.",
        tips: "You see all roles and tokens! Use this knowledge carefully. You may appear good to other abilities."
    },
    "Scarlet Woman": {
        team: "evil",
        type: "Minion",
        ability: "If there are 5 or more players alive & the Demon dies, you become the Demon.",
        tips: "You're the backup Demon! If the Imp dies with 5+ alive, you become the new Imp. Stay alive and unsuspected."
    },
    "Baron": {
        team: "evil",
        type: "Minion",
        ability: "There are extra Outsiders in play. [+2 Outsiders]",
        tips: "The game has 2 extra Outsiders. This means 2 fewer Townsfolk. Use Outsider claims as safe bluffs for evil."
    },
    // Demon
    "Imp": {
        team: "evil",
        type: "Demon",
        ability: "Each night*, choose a player: they die. If you kill yourself this way, a Minion becomes the Imp.",
        tips: "Kill strategically. You can 'starpass' by killing yourself to make a Minion the new Imp if you're about to be caught."
    },
    // Default
    "Unknown": {
        team: "unknown",
        type: "Unknown",
        ability: "Your role has not been assigned yet.",
        tips: "Wait for the Storyteller to assign your role."
    },
    "Custom": {
        team: "unknown",
        type: "Custom",
        ability: "You have a custom role.",
        tips: "Ask the Storyteller about your ability."
    }
};

function generateGameCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function createGame(storytellerSocket) {
    let code;
    do {
        code = generateGameCode();
    } while (games.has(code));

    const game = {
        code,
        storyteller: storytellerSocket.id,
        players: new Map(),
        phase: 'day',
        dayNum: 1,
        createdAt: Date.now()
    };

    games.set(code, game);
    return game;
}

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Storyteller creates a new game
    socket.on('create-game', (callback) => {
        const game = createGame(socket);
        socket.join(game.code);
        socket.gameCode = game.code;
        socket.isStoryteller = true;
        console.log('Game created:', game.code);
        callback({ success: true, code: game.code });
    });

    // Storyteller rejoins existing game
    socket.on('rejoin-game', (code, callback) => {
        const game = games.get(code);
        if (game) {
            game.storyteller = socket.id;
            socket.join(code);
            socket.gameCode = code;
            socket.isStoryteller = true;

            // Send current players list
            const players = Array.from(game.players.values());
            callback({ success: true, players });
        } else {
            callback({ success: false, error: 'Game not found' });
        }
    });

    // Player joins game
    socket.on('join-game', ({ code, name }, callback) => {
        const game = games.get(code.toUpperCase());
        if (!game) {
            callback({ success: false, error: 'Game not found. Check the code and try again.' });
            return;
        }

        // Check if name is taken
        for (const player of game.players.values()) {
            if (player.name.toLowerCase() === name.toLowerCase()) {
                callback({ success: false, error: 'That name is already taken. Please choose another.' });
                return;
            }
        }

        const player = {
            id: socket.id,
            name: name.trim(),
            role: null,
            alive: true,
            joinedAt: Date.now()
        };

        game.players.set(socket.id, player);
        socket.join(code.toUpperCase());
        socket.gameCode = code.toUpperCase();
        socket.playerName = name;

        // Notify storyteller
        io.to(game.storyteller).emit('player-joined', {
            id: socket.id,
            name: player.name,
            players: Array.from(game.players.values())
        });

        callback({ success: true, player });
        console.log(`Player ${name} joined game ${code}`);
    });

    // Storyteller assigns role to player
    socket.on('assign-role', ({ playerId, role }) => {
        const game = games.get(socket.gameCode);
        if (!game || game.storyteller !== socket.id) return;

        const player = game.players.get(playerId);
        if (player) {
            player.role = role;
            player.roleInfo = ROLE_INFO[role] || ROLE_INFO['Unknown'];

            // Send role to player
            io.to(playerId).emit('role-assigned', {
                role,
                roleInfo: player.roleInfo
            });

            // Confirm to storyteller
            socket.emit('role-assigned-confirm', { playerId, role });
            console.log(`Role ${role} assigned to player ${player.name}`);
        }
    });

    // Storyteller updates player status (alive/dead)
    socket.on('update-player-status', ({ playerId, alive }) => {
        const game = games.get(socket.gameCode);
        if (!game || game.storyteller !== socket.id) return;

        const player = game.players.get(playerId);
        if (player) {
            player.alive = alive;
            io.to(playerId).emit('status-updated', { alive });
        }
    });

    // Storyteller updates phase
    socket.on('update-phase', ({ phase, dayNum }) => {
        const game = games.get(socket.gameCode);
        if (!game || game.storyteller !== socket.id) return;

        game.phase = phase;
        game.dayNum = dayNum;

        // Notify all players in game
        io.to(socket.gameCode).emit('phase-changed', { phase, dayNum });
    });

    // Storyteller sends message to all players
    socket.on('broadcast-message', (message) => {
        const game = games.get(socket.gameCode);
        if (!game || game.storyteller !== socket.id) return;

        io.to(socket.gameCode).emit('storyteller-message', message);
    });

    // Storyteller removes player
    socket.on('remove-player', (playerId) => {
        const game = games.get(socket.gameCode);
        if (!game || game.storyteller !== socket.id) return;

        game.players.delete(playerId);
        io.to(playerId).emit('removed-from-game');
    });

    // Storyteller ends game
    socket.on('end-game', () => {
        const game = games.get(socket.gameCode);
        if (!game || game.storyteller !== socket.id) return;

        io.to(socket.gameCode).emit('game-ended');
        games.delete(socket.gameCode);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);

        if (socket.gameCode) {
            const game = games.get(socket.gameCode);
            if (game) {
                if (socket.isStoryteller) {
                    // Storyteller disconnected - keep game alive for reconnect
                    console.log('Storyteller disconnected from game:', socket.gameCode);
                } else {
                    // Player disconnected
                    const player = game.players.get(socket.id);
                    if (player) {
                        // Mark as disconnected but don't remove
                        player.disconnected = true;
                        io.to(game.storyteller).emit('player-disconnected', {
                            id: socket.id,
                            name: player.name
                        });
                    }
                }
            }
        }
    });

    // Player reconnects
    socket.on('player-reconnect', ({ code, name }, callback) => {
        const game = games.get(code.toUpperCase());
        if (!game) {
            callback({ success: false, error: 'Game not found' });
            return;
        }

        // Find player by name
        let foundPlayer = null;
        let oldSocketId = null;
        for (const [id, player] of game.players.entries()) {
            if (player.name.toLowerCase() === name.toLowerCase()) {
                foundPlayer = player;
                oldSocketId = id;
                break;
            }
        }

        if (foundPlayer) {
            // Update socket id
            game.players.delete(oldSocketId);
            foundPlayer.id = socket.id;
            foundPlayer.disconnected = false;
            game.players.set(socket.id, foundPlayer);

            socket.join(code.toUpperCase());
            socket.gameCode = code.toUpperCase();
            socket.playerName = name;

            // Notify storyteller
            io.to(game.storyteller).emit('player-reconnected', {
                id: socket.id,
                name: foundPlayer.name
            });

            callback({
                success: true,
                player: foundPlayer,
                role: foundPlayer.role,
                roleInfo: foundPlayer.roleInfo
            });
        } else {
            callback({ success: false, error: 'Player not found in game' });
        }
    });
});

// Clean up old games periodically (games older than 12 hours)
setInterval(() => {
    const now = Date.now();
    const maxAge = 12 * 60 * 60 * 1000;
    for (const [code, game] of games.entries()) {
        if (now - game.createdAt > maxAge) {
            io.to(code).emit('game-ended');
            games.delete(code);
            console.log('Cleaned up old game:', code);
        }
    }
}, 60 * 60 * 1000); // Check every hour

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
