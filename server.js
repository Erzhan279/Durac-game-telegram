const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

const server = http.createServer(app);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const io = new Server(server, { cors: { origin: "*" } });

// --- КАРТАЛАР МЕН КҮШТЕРІ ---
const suits = ['♥', '♦', '♣', '♠'];
const values = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const power = { '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

let game = {
    deck: [],
    playerHand: [],
    botHand: [],
    table: [], // { card: ..., owner: 'player'/'bot' }
    trumpCard: null,
    attacker: null, // 'player' немесе 'bot'
    winner: null
};

// Колода жасау
function createDeck() {
    let deck = [];
    for (let suit of suits) {
        for (let value of values) deck.push({ suit, value, power: power[value] });
    }
    return deck.sort(() => Math.random() - 0.5);
}

// Ойынды бастау
function startGame() {
    game.deck = createDeck();
    game.trumpCard = game.deck[game.deck.length - 1]; // Соңғы карта - козырь
    game.table = [];
    game.winner = null;

    // Карта тарату (6-6 дан)
    game.playerHand = game.deck.splice(0, 6);
    game.botHand = game.deck.splice(0, 6);

    // Кім бастайтынын анықтау (Кіші козырь кімде?)
    const pMin = getMinTrump(game.playerHand);
    const bMin = getMinTrump(game.botHand);

    if (pMin && bMin) {
        game.attacker = pMin.power < bMin.power ? 'player' : 'bot';
    } else if (pMin) {
        game.attacker = 'player';
    } else if (bMin) {
        game.attacker = 'bot';
    } else {
        game.attacker = 'player'; // Ешкімде козырь болмаса
    }

    return `Ойын басталды! Козырь: ${game.trumpCard.suit}. ${game.attacker === 'player' ? 'Сен' : 'Бот'} бастайды.`;
}

function getMinTrump(hand) {
    const trumps = hand.filter(c => c.suit === game.trumpCard.suit);
    if (trumps.length === 0) return null;
    return trumps.reduce((prev, curr) => prev.power < curr.power ? prev : curr);
}

// КАРТА ТЕКСЕРУ ЛОГИКАСЫ ✅
function canBeat(attackCard, defenseCard) {
    // 1. Егер масть бірдей болса -> үлкені жеңеді
    if (attackCard.suit === defenseCard.suit) {
        return defenseCard.power > attackCard.power;
    }
    // 2. Егер қорғанушы козырь болса (ал шабуылшы козырь емес) -> жеңеді
    if (defenseCard.suit === game.trumpCard.suit && attackCard.suit !== game.trumpCard.suit) {
        return true;
    }
    return false;
}

// БОТТЫҢ МИЫ 🧠
function botTurn(socket) {
    if (game.winner) return;

    setTimeout(() => {
        // 1. ЕГЕР БОТ ШАБУЫЛДАСА (Attacker)
        if (game.attacker === 'bot') {
            // Егер үстел бос болса -> Ең кіші картамен жүреді
            if (game.table.length === 0) {
                const cardIndex = findLowestCardIndex(game.botHand);
                playBotCard(socket, cardIndex);
            } else {
                // Үстелде карта бар -> Үстелдегі мәндерге (rank) сәйкес келетінін іздейді
                const matchingCardIndex = game.botHand.findIndex(c => 
                    game.table.some(t => t.card.value === c.value)
                );
                
                if (matchingCardIndex !== -1) {
                    playBotCard(socket, matchingCardIndex);
                } else {
                    // Тастайтын карта жоқ -> Бита
                    socket.emit('message', 'Бот: Бита! Сенің кезегің.');
                    endTurn(socket, 'bita');
                }
            }
        } 
        // 2. ЕГЕР БОТ ҚОРҒАНСА (Defender)
        else {
            const attackCard = game.table[game.table.length - 1].card;
            // Жауап беретін карта іздейді
            const defenseIndex = findDefenseCardIndex(game.botHand, attackCard);

            if (defenseIndex !== -1) {
                playBotCard(socket, defenseIndex);
            } else {
                // Жаба алмады -> Алады
                socket.emit('message', 'Бот: Аламын...');
                takeCards('bot', socket);
            }
        }
    }, 1000);
}

function findLowestCardIndex(hand) {
    // Козырь емес ең кіші картаны іздейді
    let nonTrumps = hand.map((c, i) => ({c, i})).filter(item => item.c.suit !== game.trumpCard.suit);
    if (nonTrumps.length > 0) {
        return nonTrumps.sort((a, b) => a.c.power - b.c.power)[0].i;
    }
    // Бәрі козырь болса, ең кіші козырь
    return hand.map((c, i) => ({c, i})).sort((a, b) => a.c.power - b.c.power)[0].i;
}

function findDefenseCardIndex(hand, attackCard) {
    // 1. Сол мастьтан үлкенін іздейді
    let sameSuit = hand.map((c, i) => ({c, i}))
        .filter(item => item.c.suit === attackCard.suit && item.c.power > attackCard.power)
        .sort((a, b) => a.c.power - b.c.power);
    
    if (sameSuit.length > 0) return sameSuit[0].i;

    // 2. Козырь іздейді (егер шабуыл козырь болмаса)
    if (attackCard.suit !== game.trumpCard.suit) {
        let trumps = hand.map((c, i) => ({c, i}))
            .filter(item => item.c.suit === game.trumpCard.suit)
            .sort((a, b) => a.c.power - b.c.power);
        if (trumps.length > 0) return trumps[0].i;
    }
    return -1;
}

function playBotCard(socket, index) {
    const card = game.botHand.splice(index, 1)[0];
    game.table.push({ card, owner: 'bot' });
    sendUpdate(socket);
    
    // Бот карта тастады. Егер бот қорғанса -> Енді кезек адамда (тағы тастай ма?)
    // Егер бот шабуылдаса -> Адам қорғануы керек
}

// АЙНАЛЫМДЫ АЯҚТАУ (Бита)
function endTurn(socket, type) {
    game.table = [];
    
    // Карта толықтыру
    fillHand(game.playerHand);
    fillHand(game.botHand);

    if (type === 'bita') {
        // Бита болса, кезек ауысады
        game.attacker = game.attacker === 'player' ? 'bot' : 'player';
    } 
    // "Take" (Алу) болса, кезек ауыспайды (кім алса, сол келесі жүрісті жіберіп алады)
    // Дурақта: Кім алса, сол қорғана береді емес, кім алса сол жүру құқығынан айырылады.
    // Яғни шабуылшы келесі жолы да шабуылдайды.
    
    sendUpdate(socket);
    
    // Егер жаңа кезек Боттікі болса, ол жүреді
    if (game.attacker === 'bot') botTurn(socket);
}

function takeCards(who, socket) {
    const cards = game.table.map(t => t.card);
    if (who === 'player') game.playerHand.push(...cards);
    else game.botHand.push(...cards);

    game.table = [];
    fillHand(game.attacker === 'player' ? game.playerHand : game.botHand); // Шабуылдаған адам ғана карта алады
    
    // Кім алса, сол келесіде де қорғанады. Яғни Attacker өзгермейді.
    sendUpdate(socket);

    if (game.attacker === 'bot') botTurn(socket);
}

function fillHand(hand) {
    while (hand.length < 6 && game.deck.length > 0) {
        hand.push(game.deck.shift());
    }
}

function sendUpdate(socket) {
    socket.emit('updateState', {
        playerHand: game.playerHand,
        table: game.table.map(t => t.card),
        trumpCard: game.trumpCard,
        botCardCount: game.botHand.length,
        deckCount: game.deck.length,
        attacker: game.attacker,
        winner: game.playerHand.length === 0 && game.deck.length === 0 ? 'player' : 
                (game.botHand.length === 0 && game.deck.length === 0 ? 'bot' : null)
    });
}

io.on('connection', (socket) => {
    const msg = startGame();
    sendUpdate(socket);
    socket.emit('message', msg);
    if (game.attacker === 'bot') botTurn(socket);

    // ОЙЫНШЫ ЖҮРДІ
    socket.on('playCard', (index) => {
        if (game.attacker === 'bot' && game.table.length % 2 === 0) {
            socket.emit('message', 'Қазір сенің кезегің емес!'); 
            return;
        }

        const card = game.playerHand[index];

        // ВАЛИДАЦИЯ (Тексеру)
        // 1. Егер адам Шабуылшы болса:
        if (game.attacker === 'player') {
            // Үстел бос болса кез келгенін жүре алады
            // Үстелде карта болса, тек соған ұқсас (rank) карта жүре алады
            if (game.table.length > 0) {
                const canToss = game.table.some(t => t.card.value === card.value);
                if (!canToss) {
                    socket.emit('message', 'Бұл картаны тастай алмайсың!');
                    return;
                }
            }
        } 
        // 2. Егер адам Қорғаушы болса:
        else {
            const attackCard = game.table[game.table.length - 1].card;
            if (!canBeat(attackCard, card)) {
                socket.emit('message', 'Бұл картамен жаба алмайсың!');
                return;
            }
        }

        // Жүріс дұрыс болса:
        game.playerHand.splice(index, 1);
        game.table.push({ card, owner: 'player' });
        sendUpdate(socket);

        // Ботқа кезек береміз
        botTurn(socket);
    });

    socket.on('actionBita', () => {
        if (game.attacker === 'player') {
            // Егер мен шабуылшы болсам және үстелде карта болса -> Бита жасай аламын
            if (game.table.length > 0 && game.table.length % 2 === 0) {
                endTurn(socket, 'bita');
            } else {
                socket.emit('message', 'Әзірге бита жасай алмайсың!');
            }
        } else {
            socket.emit('message', 'Сен қорғанып жатырсың, тек ала аласың!');
        }
    });

    socket.on('actionTake', () => {
        if (game.attacker === 'bot') {
            takeCards('player', socket);
        } else {
            socket.emit('message', 'Сен шабуылдап жатырсың ғой!');
        }
    });

    socket.on('restart', () => {
        const msg = startGame();
        sendUpdate(socket);
        socket.emit('message', msg);
        if (game.attacker === 'bot') botTurn(socket);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Smart Durak Server running on ${PORT}`);
});
