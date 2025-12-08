const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

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
    // Кіші козырь кімде екенін анықтау керек, әзірге адам бастайды
    game.attacker = 'player'; 
}

// ЛОГИКА: Картаны жабуға бола ма?
function canBeat(attackCard, defenseCard) {
    if (attackCard.suit === defenseCard.suit) return defenseCard.power > attackCard.power;
    if (defenseCard.suit === game.trumpCard.suit && attackCard.suit !== game.trumpCard.suit) return true;
    return false;
}

// ЛОГИКА: Үстелге тастауға бола ма? (Подкинуть)
function canToss(card) {
    if (game.table.length === 0) return true; // Бірінші жүріс
    return game.table.some(t => t.card.value === card.value);
}

function botTurn(socket) {
    if (game.winner) return;
    setTimeout(() => {
        if (game.attacker === 'player') { 
            // БОТ ҚОРҒАНАДЫ
            const attackCard = game.table[game.table.length - 1].card;
            // Ең кіші жарайтын картаны іздейміз
            let candidates = game.botHand.filter(c => canBeat(attackCard, c));
            candidates.sort((a,b) => a.power - b.power); // Әлсіз картамен жабуға тырысу

            if (candidates.length > 0) {
                const card = candidates[0];
                const idx = game.botHand.indexOf(card);
                game.botHand.splice(idx, 1);
                game.table.push({ card, owner: 'bot' });
                sendUpdate(socket);
            } else {
                takeCards('bot', socket);
            }
        } else { 
            // БОТ ШАБУЫЛДАЙДЫ
            if (game.table.length === 0) {
                // Ең кіші козырь емес картамен жүру
                let minCard = game.botHand.sort((a,b) => {
                    if (a.suit === game.trumpCard.suit && b.suit !== game.trumpCard.suit) return 1;
                    if (a.suit !== game.trumpCard.suit && b.suit === game.trumpCard.suit) return -1;
                    return a.power - b.power;
                })[0];
                
                const idx = game.botHand.indexOf(minCard);
                game.botHand.splice(idx, 1);
                game.table.push({ card: minCard, owner: 'bot' });
                sendUpdate(socket);
            } else {
                // Подкинуть (үстелдегі бар картаны)
                let tossCandidates = game.botHand.filter(c => canToss(c));
                if (tossCandidates.length > 0) {
                    tossCandidates.sort((a,b) => a.power - b.power);
                    const card = tossCandidates[0];
                    const idx = game.botHand.indexOf(card);
                    game.botHand.splice(idx, 1);
                    game.table.push({ card, owner: 'bot' });
                    sendUpdate(socket);
                } else {
                    endTurn(socket); // Бита
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
    // Адам алса -> Бот шабуылдайды. Бот алса -> Адам шабуылдайды
    // Бірақ дурақта: кім алса, сол келесі жүрісті жібереді.
    // Яғни Attacker өзгермейді (егер мен шабуылдасам, бот алса -> мен тағы жүрем)
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
        if (game.attacker === 'bot' && game.table.length % 2 === 0) return; // Кезек емес
        
        const card = game.playerHand[idx];
        
        // ВАЛИДАЦИЯ
        if (game.attacker === 'player') {
            if (!canToss(card)) { socket.emit('message', "Бұл карта жүрмейді!"); return; }
        } else {
            const attackCard = game.table[game.table.length - 1].card;
            if (!canBeat(attackCard, card)) { socket.emit('message', "Жаба алмайсың!"); return; }
        }

        game.playerHand.splice(idx, 1);
        game.table.push({ card, owner: 'player' });
        sendUpdate(socket);
        botTurn(socket);
    });

    socket.on('actionBita', () => { if(game.attacker === 'player') endTurn(socket); });
    socket.on('actionTake', () => { if(game.attacker === 'bot') takeCards('player', socket); });
    socket.on('restart', () => { startGame(); sendUpdate(socket); });
    
    app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });
});

server.listen(process.env.PORT || 3000);
