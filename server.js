const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// --- 👇 ЕҢ МАҢЫЗДЫ ЖОЛ! ОСЫ ЖОЛ СУРЕТТІ АШАДЫ 👇 ---
app.use(express.static(path.join(__dirname, 'public')));
// ----------------------------------------------------

const server = http.createServer(app);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const io = new Server(server, { cors: { origin: "*" } });

// --- ОЙЫН ЛОГИКАСЫ (Бот, Карта, Ережелер) ---
const suits = ['♥', '♦', '♣', '♠'];
const values = ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const power = { '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };

let game = {
    deck: [], playerHand: [], botHand: [], table: [], 
    trumpCard: null, attacker: 'player', winner: null
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
    game.attacker = 'player';
}

function botTurn(socket) {
    if (game.winner) return;
    setTimeout(() => {
        if (game.attacker === 'player') { 
            // Қорғаныс
            if (game.table.length === 0) return;
            const attackCard = game.table[game.table.length - 1].card;
            let defIndex = game.botHand.findIndex(c => {
                if(c.suit === attackCard.suit) return c.power > attackCard.power;
                if(c.suit === game.trumpCard.suit && attackCard.suit !== game.trumpCard.suit) return true;
                return false;
            });
            
            if (defIndex !== -1) {
                game.table.push({ card: game.botHand.splice(defIndex, 1)[0], owner: 'bot' });
                sendUpdate(socket);
            } else {
                takeCards('bot', socket);
            }
        } else { 
            // Шабуыл
            if (game.table.length === 0) {
                game.botHand.sort((a,b)=>a.power-b.power);
                game.table.push({ card: game.botHand.shift(), owner: 'bot' });
                sendUpdate(socket);
            } else {
                const matchIndex = game.botHand.findIndex(c => game.table.some(t => t.card.value === c.value));
                if (matchIndex !== -1) {
                    game.table.push({ card: game.botHand.splice(matchIndex, 1)[0], owner: 'bot' });
                    sendUpdate(socket);
                } else {
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
    if (game.attacker === 'bot') botTurn(socket);
}

function endTurn(socket) {
    game.table = [];
    fillHands();
    game.attacker = game.attacker === 'player' ? 'bot' : 'player';
    sendUpdate(socket);
    if (game.attacker === 'bot') botTurn(socket);
}

function fillHands() {
    while (game.playerHand.length < 6 && game.deck.length > 0) game.playerHand.push(game.deck.shift());
    while (game.botHand.length < 6 && game.deck.length > 0) game.botHand.push(game.deck.shift());
}

function sendUpdate(socket) {
    if (game.deck.length === 0 && game.playerHand.length === 0) game.winner = 'player';
    if (game.deck.length === 0 && game.botHand.length === 0) game.winner = 'bot';
    socket.emit('updateState', {
        playerHand: game.playerHand, table: game.table, trumpCard: game.trumpCard,
        botCardCount: game.botHand.length, deckCount: game.deck.length,
        attacker: game.attacker, winner: game.winner
    });
}

io.on('connection', (socket) => {
    startGame();
    sendUpdate(socket);
    socket.on('playCard', (idx) => {
        if (game.attacker === 'bot' && game.table.length % 2 === 0) return;
        game.table.push({ card: game.playerHand.splice(idx, 1)[0], owner: 'player' });
        sendUpdate(socket);
        botTurn(socket);
    });
    socket.on('actionBita', () => { if(game.attacker === 'player') endTurn(socket); });
    socket.on('actionTake', () => { if(game.attacker === 'bot') takeCards('player', socket); });
    socket.on('restart', () => { startGame(); sendUpdate(socket); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
});
