const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// СУРЕТТЕРДІ АШУ (Маңызды!)
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const io = new Server(server, { cors: { origin: "*" } });

// --- ОЙЫН ЛОГИКАСЫ ---
const suits = ['♥', '♦', '♣', '♠'];
const values = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const power = { '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

let game = {
    deck: [],
    playerHand: [],
    botHand: [],
    table: [], 
    trumpCard: null,
    attacker: null, // 'player' немесе 'bot'
    winner: null
};

function createDeck() {
    let deck = [];
    for (let suit of suits) {
        for (let value of values) deck.push({ suit, value, power: power[value] });
    }
    return deck.sort(() => Math.random() - 0.5);
}

function startGame() {
    game.deck = createDeck();
    game.trumpCard = game.deck[game.deck.length - 1]; 
    game.table = [];
    game.winner = null;
    game.playerHand = game.deck.splice(0, 6);
    game.botHand = game.deck.splice(0, 6);
    game.attacker = 'player'; // Әзірге адам бастасын
    return "Ойын басталды!";
}

// КАРТА ТЕКСЕРУ
function canBeat(attackCard, defenseCard) {
    if (attackCard.suit === defenseCard.suit) return defenseCard.power > attackCard.power;
    if (defenseCard.suit === game.trumpCard.suit && attackCard.suit !== game.trumpCard.suit) return true;
    return false;
}

// БОТТЫҢ МИЫ
function botTurn(socket) {
    if (game.winner) return;

    setTimeout(() => {
        // 1. БОТ ҚОРҒАНАДЫ
        if (game.attacker === 'player') {
            if (game.table.length === 0) return; // Қорғанатын ештеңе жоқ
            
            const attackCard = game.table[game.table.length - 1].card;
            
            // Жауап іздейді
            let defenseIndex = game.botHand.findIndex(c => canBeat(attackCard, c));
            
            if (defenseIndex !== -1) {
                // Жабады
                const card = game.botHand.splice(defenseIndex, 1)[0];
                game.table.push({ card, owner: 'bot' });
                sendUpdate(socket);
            } else {
                // Алады
                socket.emit('message', 'Бот карталарды алды!');
                takeCards('bot', socket);
            }
        } 
        // 2. БОТ ШАБУЫЛДАЙДЫ
        else {
            if (game.table.length === 0) {
                // Ең кіші картамен жүреді
                game.botHand.sort((a, b) => a.power - b.power);
                const card = game.botHand.shift();
                game.table.push({ card, owner: 'bot' });
                sendUpdate(socket);
            } else {
                // Үстелдегі картаға ұқсасын тастайды
                const matchIndex = game.botHand.findIndex(c => game.table.some(t => t.card.value === c.value));
                if (matchIndex !== -1) {
                    const card = game.botHand.splice(matchIndex, 1)[0];
                    game.table.push({ card, owner: 'bot' });
                    sendUpdate(socket);
                } else {
                    // Бита
                    socket.emit('message', 'Бот: Бита!');
                    endTurn(socket);
                }
            }
        }
    }, 1000);
}

function takeCards(who, socket) {
    const cards = game.table.map(t => t.card);
    if (who === 'player') game.playerHand.push(...cards);
    else game.botHand.push(...cards);
    
    game.table = [];
    fillHands();
    sendUpdate(socket);
    
    // Кім алса, сол келесі жолы да қорғанады (шабуылшы ауыспайды)
    if (game.attacker === 'bot') botTurn(socket);
}

function endTurn(socket) {
    game.table = [];
    fillHands();
    // Кезек ауысады
    game.attacker = game.attacker === 'player' ? 'bot' : 'player';
    sendUpdate(socket);
    
    if (game.attacker === 'bot') botTurn(socket);
}

function fillHands() {
    while (game.playerHand.length < 6 && game.deck.length > 0) game.playerHand.push(game.deck.shift());
    while (game.botHand.length < 6 && game.deck.length > 0) game.botHand.push(game.deck.shift());
}

function sendUpdate(socket) {
    // Жеңімпаз бар ма?
    if (game.deck.length === 0 && game.playerHand.length === 0) game.winner = 'player';
    if (game.deck.length === 0 && game.botHand.length === 0) game.winner = 'bot';

    socket.emit('updateState', {
        playerHand: game.playerHand,
        table: game.table,
        trumpCard: game.trumpCard,
        botCardCount: game.botHand.length,
        deckCount: game.deck.length,
        attacker: game.attacker,
        winner: game.winner
    });
}

io.on('connection', (socket) => {
    startGame();
    sendUpdate(socket);

    socket.on('playCard', (index) => {
        if (game.attacker === 'bot' && game.table.length % 2 === 0) return; // Кезек сенікі емес

        const card = game.playerHand[index];
        
        // Валидация
        if (game.attacker === 'player') {
            if (game.table.length > 0) {
                const canToss = game.table.some(t => t.card.value === card.value);
                if (!canToss) return; // Үстелде жоқ картаны тастама
            }
        } else {
            const attackCard = game.table[game.table.length - 1].card;
            if (!canBeat(attackCard, card)) return; // Жаба алмайсың
        }

        game.playerHand.splice(index, 1);
        game.table.push({ card, owner: 'player' });
        sendUpdate(socket);
        botTurn(socket);
    });

    socket.on('actionBita', () => {
        if (game.attacker === 'player' && game.table.length > 0) endTurn(socket);
    });

    socket.on('actionTake', () => {
        if (game.attacker === 'bot') takeCards('player', socket);
    });

    socket.on('restart', () => {
        startGame();
        sendUpdate(socket);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
});
