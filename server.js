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

// Narrator credentials (override via env vars in prod)
const NARRATOR_USER = process.env.NARRATOR_USER || 'Nick';
const NARRATOR_PASSWORD = process.env.NARRATOR_PASSWORD || 'bluejack6';

// Most recent active game — TV auto-follows this
let activeGameCode = null;
// Full narrator-side state snapshot for TV mirroring
let activeGameSnapshot = null;

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

    // ========== BAD MOON RISING ==========
    // Townsfolk (Bad Moon Rising)
    "Grandmother": {
        team: "good",
        type: "Townsfolk",
        ability: "You start knowing a good player & their character. If the Demon kills them, you die too.",
        tips: "Protect your grandchild! Share info carefully - if evil learns who they are, they might kill them to get you too."
    },
    "Sailor": {
        team: "good",
        type: "Townsfolk",
        ability: "Each night, choose an alive player: either you or they are drunk until dusk. You can't die.",
        tips: "You cannot die while sober. Choose yourself to stay safe, or drunk others strategically. Be careful who you pick!"
    },
    "Chambermaid": {
        team: "good",
        type: "Townsfolk",
        ability: "Each night, choose 2 alive players (not yourself): you learn how many woke tonight due to their ability.",
        tips: "Track who wakes at night. This helps identify active roles and catch evil players in lies about their abilities."
    },
    "Exorcist": {
        team: "good",
        type: "Townsfolk",
        ability: "Each night*, choose a player (different to last night): the Demon, if chosen, learns who you are & doesn't wake tonight.",
        tips: "If no one dies at night, you may have found the Demon! But they'll know who you are - be prepared."
    },
    "Innkeeper": {
        team: "good",
        type: "Townsfolk",
        ability: "Each night*, choose 2 players: they can't die tonight, but 1 is drunk until dusk.",
        tips: "Protect key players but remember one will be drunk. Their ability won't work correctly that night."
    },
    "Gambler": {
        team: "good",
        type: "Townsfolk",
        ability: "Each night*, choose a player & guess their character: if you guess wrong, you die.",
        tips: "High risk, high reward! Only guess when confident. A correct guess confirms a role; wrong guess kills you."
    },
    "Gossip": {
        team: "good",
        type: "Townsfolk",
        ability: "Each day, you may make a public statement. Tonight, if it was true, a player dies.",
        tips: "Be careful what you say! If your statement is true, someone dies. Use this to test theories or be vague."
    },
    "Courtier": {
        team: "good",
        type: "Townsfolk",
        ability: "Once per game, at night, choose a character: they are drunk for 3 nights & 3 days.",
        tips: "Powerful one-shot ability. Drunk the Demon to stop kills, or a dangerous Minion. Choose wisely!"
    },
    "Professor": {
        team: "good",
        type: "Townsfolk",
        ability: "Once per game, at night*, choose a dead player: if they are a Townsfolk, they are resurrected.",
        tips: "You can bring back a dead Townsfolk! Save this for a confirmed good player or crucial role. Only works on Townsfolk."
    },
    "Minstrel": {
        team: "good",
        type: "Townsfolk",
        ability: "When a Minion dies by execution, all other players (except Travellers) are drunk until dusk tomorrow.",
        tips: "If a Minion is executed, everyone gets drunk! This can disrupt evil plans but also affects good abilities."
    },
    "Tea Lady": {
        team: "good",
        type: "Townsfolk",
        ability: "If both your alive neighbours are good, they can't die.",
        tips: "Your neighbors are protected if they're both good. Sit strategically and keep good players next to you alive!"
    },
    "Pacifist": {
        team: "good",
        type: "Townsfolk",
        ability: "Executed good players might not die.",
        tips: "You give good players a chance to survive execution. The Storyteller decides - don't rely on it completely."
    },
    "Fool": {
        team: "good",
        type: "Townsfolk",
        ability: "The first time you die, you don't.",
        tips: "You survive your first death! This makes you a safe target for risky plays early game."
    },

    // Outsiders (Bad Moon Rising)
    "Tinker": {
        team: "good",
        type: "Outsider",
        ability: "You might die at any time.",
        tips: "The Storyteller can kill you whenever they want. This creates chaos and makes your death hard to read."
    },
    "Moonchild": {
        team: "good",
        type: "Outsider",
        ability: "When you learn that you died, publicly choose 1 alive player. Tonight, if it was a good player, they die.",
        tips: "If you die, you must choose someone. Pick someone you suspect is evil to avoid killing a good player!"
    },
    "Goon": {
        team: "good",
        type: "Outsider",
        ability: "Each night, the 1st player to choose you with their ability is drunk until dusk. You become their alignment.",
        tips: "You drunk the first person to target you AND become their alignment. You might turn evil!"
    },
    "Lunatic": {
        team: "good",
        type: "Outsider",
        ability: "You think you are a Demon, but you are not. The Demon knows who you are & who you choose at night.",
        tips: "You believe you're the Demon but you're actually good. The real Demon sees your choices. Play along!"
    },

    // Minions (Bad Moon Rising)
    "Godfather": {
        team: "evil",
        type: "Minion",
        ability: "You start knowing which Outsiders are in play. If 1 died today, choose a player tonight: they die. [-1 or +1 Outsider]",
        tips: "You know all Outsiders and can kill when one dies by execution. The game also has modified Outsider count."
    },
    "Devil's Advocate": {
        team: "evil",
        type: "Minion",
        ability: "Each night, choose a living player (different to last night): if executed tomorrow, they don't die.",
        tips: "Protect the Demon or yourself from execution! Rotate your choice each night to keep evil alive."
    },
    "Assassin": {
        team: "evil",
        type: "Minion",
        ability: "Once per game, at night*, choose a player: they die, even if for some reason they could not.",
        tips: "Your kill bypasses ALL protection. Save it for a protected player like the Fool, Sailor, or Tea Lady's neighbor."
    },
    "Mastermind": {
        team: "evil",
        type: "Minion",
        ability: "If the Demon dies by execution (ending the game), play for 1 more day. If a player is then executed, their team loses.",
        tips: "Even if the Demon is executed, the game continues! Get a good player executed the next day to win."
    },

    // Demons (Bad Moon Rising)
    "Zombuul": {
        team: "evil",
        type: "Demon",
        ability: "Each night*, if no-one died today, choose a player: they die. The 1st time you die, you live but register as dead.",
        tips: "You survive your first death and appear dead! No kills happen on days with executions. Play dead strategically."
    },
    "Pukka": {
        team: "evil",
        type: "Demon",
        ability: "Each night, choose a player: they are poisoned. The previously poisoned player dies then becomes healthy.",
        tips: "Your victims are poisoned first, then die the next night. This delays deaths and corrupts information."
    },
    "Shabaloth": {
        team: "evil",
        type: "Demon",
        ability: "Each night*, choose 2 players: they die. A dead player you chose last night might be regurgitated.",
        tips: "You kill two players per night! Sometimes a previous victim comes back. Very aggressive Demon."
    },
    "Po": {
        team: "evil",
        type: "Demon",
        ability: "Each night*, you may choose a player: they die. If your last choice was no-one, choose 3 players tonight.",
        tips: "Skip a night to kill 3 the next night! This creates unpredictable kill patterns. Very deadly."
    },

    // ========== SECTS & VIOLETS ==========
    // Townsfolk
    "Clockmaker": {
        team: "good",
        type: "Townsfolk",
        ability: "You start knowing how many steps from the Demon to its nearest Minion.",
        tips: "Count clockwise and counter-clockwise — whichever is shorter. Helps triangulate evil."
    },
    "Dreamer": {
        team: "good",
        type: "Townsfolk",
        ability: "Each night, choose a player (not yourself or Travellers): you learn 1 good & 1 evil character, 1 of which is correct.",
        tips: "You get two options per night — one is the truth. Cross-reference claims to narrow it down."
    },
    "Snake Charmer": {
        team: "good",
        type: "Townsfolk",
        ability: "Each night, choose an alive player: a chosen Demon swaps characters & alignments with you & is then poisoned.",
        tips: "Swap with the Demon to neutralize them! You become the Demon (but poisoned) — huge swing."
    },
    "Mathematician": {
        team: "good",
        type: "Townsfolk",
        ability: "Each night, you learn how many players' abilities worked abnormally (since dawn) due to another character.",
        tips: "A non-zero count means someone's ability was disrupted — poisoning, drunkenness, or similar."
    },
    "Flowergirl": {
        team: "good",
        type: "Townsfolk",
        ability: "Each night*, you learn if a Demon voted today.",
        tips: "If the Demon voted on a nomination today, you'll know. Narrow them down by who voted."
    },
    "Town Crier": {
        team: "good",
        type: "Townsfolk",
        ability: "Each night*, you learn if a Minion nominated today.",
        tips: "If any Minion nominated, you'll know. Helps identify evil nominators."
    },
    "Oracle": {
        team: "good",
        type: "Townsfolk",
        ability: "Each night*, you learn how many dead players are evil.",
        tips: "A running count of dead evil. Combined with execution info, very revealing."
    },
    "Savant": {
        team: "good",
        type: "Townsfolk",
        ability: "Each day, you may visit the Storyteller to learn 2 things in private: 1 is true & 1 is false.",
        tips: "You get two statements per day, one true. Careful logic will separate them."
    },
    "Seamstress": {
        team: "good",
        type: "Townsfolk",
        ability: "Once per game, at night, choose 2 players (not yourself): you learn if they are the same alignment.",
        tips: "One-shot, very powerful. Save for a critical pairing you need confirmed."
    },
    "Philosopher": {
        team: "good",
        type: "Townsfolk",
        ability: "Once per game, at night, choose a good character: gain that ability. If this character is in play, they are drunk.",
        tips: "Steal any good ability! But if the real role is in play, they become drunk. Use carefully."
    },
    "Artist": {
        team: "good",
        type: "Townsfolk",
        ability: "Once per game, during the day, privately ask the Storyteller any yes/no question.",
        tips: "One-shot direct question to the Storyteller. Phrase carefully to extract maximum info."
    },
    "Juggler": {
        team: "good",
        type: "Townsfolk",
        ability: "On your 1st day, publicly guess up to 5 players' characters. That night, you learn how many you got correct.",
        tips: "Only works day 1! Guess widely — you just need the count of correct guesses."
    },
    "Sage": {
        team: "good",
        type: "Townsfolk",
        ability: "If the Demon kills you, you learn that it is 1 of 2 players.",
        tips: "If you die at night to the Demon, you narrow them to 2 players. Big reveal."
    },

    // Outsiders (Sects & Violets)
    "Mutant": {
        team: "good",
        type: "Outsider",
        ability: "If you are 'mad' about being an Outsider, you might be executed.",
        tips: "Don't claim Outsider publicly or you may be executed by the Storyteller!"
    },
    "Sweetheart": {
        team: "good",
        type: "Outsider",
        ability: "When you die, 1 player is drunk from now on.",
        tips: "Your death poisons a player permanently. Storyteller picks who."
    },
    "Barber": {
        team: "good",
        type: "Outsider",
        ability: "If you died today or tonight, the Demon may choose 2 players to swap characters.",
        tips: "Your death lets the Demon swap two players' roles. Chaotic but can backfire on evil."
    },
    "Klutz": {
        team: "good",
        type: "Outsider",
        ability: "When you learn that you died, publicly choose 1 alive player: if good, your team loses.",
        tips: "If you die, pick someone you're sure is evil — or you lose the game!"
    },

    // Minions (Sects & Violets)
    "Evil Twin": {
        team: "evil",
        type: "Minion",
        ability: "You & an opposing player know each other. If the good player is executed, evil wins. Good can't win if you both live.",
        tips: "You and a specific good player know each other's role. Evil twin must die for good to win."
    },
    "Witch": {
        team: "evil",
        type: "Minion",
        ability: "Each night, choose a player: if they nominate tomorrow, they die. If only 3 players live, you lose this ability.",
        tips: "Curse a player — they die if they nominate. Shuts down good nominators."
    },
    "Cerenovus": {
        team: "evil",
        type: "Minion",
        ability: "Each night, choose a player & a good character: they are 'mad' they are this character tomorrow, or might be executed.",
        tips: "Force a player to claim a specific role publicly or face execution. Creates confusion."
    },
    "Pit-Hag": {
        team: "evil",
        type: "Minion",
        ability: "Each night*, choose a player & a character they become (if not in-play). If a Demon is made, deaths tonight are arbitrary.",
        tips: "Swap a player into a new role! Can even create a new Demon. Very versatile."
    },

    // Demons (Sects & Violets)
    "Fang Gu": {
        team: "evil",
        type: "Demon",
        ability: "Each night*, choose a player: they die. The 1st Outsider this kills becomes an evil Fang Gu & you die instead. [+1 Outsider]",
        tips: "Killing an Outsider transforms them into the new Fang Gu — you die but evil continues!"
    },
    "Vigormortis": {
        team: "evil",
        type: "Demon",
        ability: "Each night*, choose a player: they die. Minions you kill keep their ability & poison 1 Townsfolk neighbour. [-1 Outsider]",
        tips: "Kill your own Minions — they keep their ability AND poison a neighbor. Devastating."
    },
    "No Dashii": {
        team: "evil",
        type: "Demon",
        ability: "Each night*, choose a player: they die. Your 2 Townsfolk neighbours are poisoned.",
        tips: "Your Townsfolk neighbors are always poisoned. Their info is wrong all game."
    },
    "Vortox": {
        team: "evil",
        type: "Demon",
        ability: "Each night*, choose a player: they die. Townsfolk abilities yield false info. Good wins only if good executes each day.",
        tips: "All Townsfolk info is FALSE. Good must execute every day to win — very aggressive."
    },

    // ========== TRAVELLERS ==========
    "Scapegoat": {
        team: "good",
        type: "Traveller",
        ability: "If a player of your alignment is executed, you might die instead.",
        tips: "You can take the fall for an execution. Storyteller decides."
    },
    "Gunslinger": {
        team: "good",
        type: "Traveller",
        ability: "Each day, after the 1st vote has been made, you may choose to shoot the voter. They die.",
        tips: "Shoot the first voter each day. Bold, public removal tool."
    },
    "Beggar": {
        team: "good",
        type: "Traveller",
        ability: "You must use a vote token to vote. A player may give you theirs. If a dead player does, you learn their alignment.",
        tips: "Can't vote without a token from another player. Dead players' tokens reveal alignment."
    },
    "Bureaucrat": {
        team: "good",
        type: "Traveller",
        ability: "Each day, privately choose a player: their vote counts 3 times or 1/3 tomorrow.",
        tips: "Buff or weaken a voter's weight. Strategic manipulation of nominations."
    },
    "Thief": {
        team: "evil",
        type: "Traveller",
        ability: "Each day, privately choose a player: their vote counts negatively tomorrow.",
        tips: "Turn a voter against their own side. Great for derailing good's plans."
    },
    "Butcher": {
        team: "evil",
        type: "Traveller",
        ability: "Each day, after the 1st execution, you may nominate again.",
        tips: "Extra nomination after each execution. Keeps executions rolling."
    },
    "Bone Collector": {
        team: "evil",
        type: "Traveller",
        ability: "Once per game, at night, choose a dead player: they regain their ability until dusk.",
        tips: "Revive a dead player's ability for a day. Can bring back Minions' powers."
    },
    "Harlot": {
        team: "good",
        type: "Traveller",
        ability: "Each night*, choose a player: you learn their character, but both of you might die.",
        tips: "Risky info — both might die. Use on a suspected evil player."
    },
    "Barista": {
        team: "good",
        type: "Traveller",
        ability: "Each night, choose a player: their ability works twice or they are sober & healthy, until dusk.",
        tips: "Double a player's ability OR cure them of drunk/poison. Very flexible."
    },
    "Judge": {
        team: "good",
        type: "Traveller",
        ability: "Once per game, if another player nominates, you may choose to force the current execution outcome to be flipped.",
        tips: "One-shot reversal of an execution. Huge swing at a key moment."
    },
    "Matron": {
        team: "good",
        type: "Traveller",
        ability: "Each day, you may choose up to 3 pairs of players to swap seats. Players may not whisper except with their neighbours.",
        tips: "Reshuffle the circle — disrupts whispering and adjacency-based abilities."
    },
    "Deviant": {
        team: "good",
        type: "Traveller",
        ability: "If you were funny today, you can not be exiled.",
        tips: "Stay entertaining and you can't be exiled. Lean into it!"
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
        // Multiple narrator sockets can control the same game (e.g. PC + tablet)
        storytellers: new Set([storytellerSocket.id]),
        players: new Map(),
        phase: 'day',
        dayNum: 1,
        createdAt: Date.now()
    };

    games.set(code, game);
    return game;
}

function isStoryteller(game, socketId) {
    return game && game.storytellers && game.storytellers.has(socketId);
}

function emitToStorytellers(game, event, data, exceptSocketId) {
    if (!game || !game.storytellers) return;
    for (const sid of game.storytellers) {
        if (sid !== exceptSocketId) io.to(sid).emit(event, data);
    }
}

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Narrator authentication (required before creating/controlling games)
    socket.on('narrator-login', ({ user, pass }, callback) => {
        if (user === NARRATOR_USER && pass === NARRATOR_PASSWORD) {
            socket.narratorAuthed = true;
            callback({ success: true });
        } else {
            callback({ success: false, error: 'Invalid username or password' });
        }
    });

    // TV display joins a passive-watcher room and gets current active game
    socket.on('tv-join', (callback) => {
        socket.join('tv-watchers');
        socket.isTv = true;
        if (activeGameCode && games.has(activeGameCode)) {
            callback({ active: true, code: activeGameCode, state: activeGameSnapshot });
        } else {
            callback({ active: false });
        }
    });

    // Narrator broadcasts a full state snapshot — server mirrors it to:
    //   - the TV (`tv-state-update`)
    //   - all OTHER narrator tabs in the same game (`peer-narrator-state`)
    //   - all players in the game room, sanitized (`game-roster-update`)
    socket.on('narrator-state-update', (state) => {
        if (!socket.isStoryteller || !socket.narratorAuthed) return;
        if (state && state.code && games.has(state.code)) {
            const game = games.get(state.code);
            activeGameCode = state.code;
            activeGameSnapshot = state;
            io.to('tv-watchers').emit('tv-state-update', state);
            emitToStorytellers(game, 'peer-narrator-state', state, socket.id);

            const sanitized = {
                code: state.code,
                phase: state.phase,
                dayNum: state.dayNum,
                edition: state.edition || null,
                players: (state.players || []).map(p => ({
                    name: p.name,
                    alive: p.alive !== false
                }))
            };
            io.to(state.code).emit('game-roster-update', sanitized);
        }
    });

    // Storyteller creates a new game
    socket.on('create-game', (callback) => {
        if (!socket.narratorAuthed) {
            return callback({ success: false, error: 'Not authenticated' });
        }
        const game = createGame(socket);
        socket.join(game.code);
        socket.gameCode = game.code;
        socket.isStoryteller = true;
        activeGameCode = game.code;
        activeGameSnapshot = null;
        io.to('tv-watchers').emit('active-game-changed', { code: game.code });
        console.log('Game created:', game.code);
        callback({ success: true, code: game.code });
    });

    // Storyteller rejoins existing game (additional narrator tabs join here too)
    socket.on('rejoin-game', (code, callback) => {
        if (!socket.narratorAuthed) {
            return callback({ success: false, error: 'Not authenticated' });
        }
        code = (code || '').toUpperCase();
        const game = games.get(code);
        if (game) {
            // Migrate pre-existing single-storyteller games on the fly
            if (!game.storytellers) game.storytellers = new Set();
            if (game.storyteller) {
                game.storytellers.add(game.storyteller);
                delete game.storyteller;
            }
            game.storytellers.add(socket.id);
            socket.join(code);
            socket.gameCode = code;
            socket.isStoryteller = true;
            activeGameCode = code;

            // Send current players list + any snapshot this game has on the server
            // (so a second narrator tab can populate its UI without clobbering state)
            const players = Array.from(game.players.values());
            callback({
                success: true,
                players,
                snapshot: activeGameCode === code ? activeGameSnapshot : null
            });
        } else {
            callback({ success: false, error: 'Game not found' });
        }
    });

    // Query server for the current active game (used by narrator to recover after accidental reset)
    socket.on('get-active-game', (callback) => {
        if (!socket.narratorAuthed) {
            return callback({ success: false, error: 'Not authenticated' });
        }
        if (activeGameCode && games.has(activeGameCode)) {
            const game = games.get(activeGameCode);
            callback({
                success: true,
                code: activeGameCode,
                players: Array.from(game.players.values()),
                snapshot: activeGameSnapshot
            });
        } else {
            callback({ success: false, error: 'No active game' });
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

        // Notify all narrator tabs
        emitToStorytellers(game, 'player-joined', {
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
        if (!game || !isStoryteller(game, socket.id)) return;

        const player = game.players.get(playerId);
        if (player) {
            player.role = role;
            player.roleInfo = ROLE_INFO[role] || ROLE_INFO['Unknown'];

            // Send role to player
            io.to(playerId).emit('role-assigned', {
                role,
                roleInfo: player.roleInfo
            });

            // Confirm to all narrator tabs
            emitToStorytellers(game, 'role-assigned-confirm', { playerId, role });
            console.log(`Role ${role} assigned to player ${player.name}`);
        }
    });

    // Storyteller updates player status (alive/dead)
    socket.on('update-player-status', ({ playerId, alive }) => {
        const game = games.get(socket.gameCode);
        if (!game || !isStoryteller(game, socket.id)) return;

        const player = game.players.get(playerId);
        if (player) {
            player.alive = alive;
            io.to(playerId).emit('status-updated', { alive });
        }
    });

    // Storyteller updates phase
    socket.on('update-phase', ({ phase, dayNum }) => {
        const game = games.get(socket.gameCode);
        if (!game || !isStoryteller(game, socket.id)) return;

        game.phase = phase;
        game.dayNum = dayNum;

        // Notify all players in game
        io.to(socket.gameCode).emit('phase-changed', { phase, dayNum });
    });

    // Storyteller sends message to all players
    socket.on('broadcast-message', (message) => {
        const game = games.get(socket.gameCode);
        if (!game || !isStoryteller(game, socket.id)) return;

        io.to(socket.gameCode).emit('storyteller-message', message);
    });

    // Storyteller removes player
    socket.on('remove-player', (playerId) => {
        const game = games.get(socket.gameCode);
        if (!game || !isStoryteller(game, socket.id)) return;

        game.players.delete(playerId);
        io.to(playerId).emit('removed-from-game');
    });

    // Storyteller ends game
    socket.on('end-game', () => {
        const game = games.get(socket.gameCode);
        if (!game || !isStoryteller(game, socket.id)) return;

        io.to(socket.gameCode).emit('game-ended');
        games.delete(socket.gameCode);
        if (activeGameCode === socket.gameCode) {
            activeGameCode = null;
            activeGameSnapshot = null;
            io.to('tv-watchers').emit('active-game-changed', { code: null });
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);

        if (socket.gameCode) {
            const game = games.get(socket.gameCode);
            if (game) {
                if (socket.isStoryteller) {
                    // A narrator tab closed. Keep the game alive; just drop this
                    // socket from the set so we don't try to emit to a dead conn.
                    if (game.storytellers) game.storytellers.delete(socket.id);
                    console.log('Narrator tab disconnected from game:', socket.gameCode);
                } else {
                    // Player disconnected
                    const player = game.players.get(socket.id);
                    if (player) {
                        // Mark as disconnected but don't remove
                        player.disconnected = true;
                        emitToStorytellers(game, 'player-disconnected', {
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

            // Notify all narrator tabs
            emitToStorytellers(game, 'player-reconnected', {
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
            if (activeGameCode === code) {
                activeGameCode = null;
                activeGameSnapshot = null;
                io.to('tv-watchers').emit('active-game-changed', { code: null });
            }
            console.log('Cleaned up old game:', code);
        }
    }
}, 60 * 60 * 1000); // Check every hour

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
