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
    for (let s of suits) for (let v of values) deck.push({ suit: s, value: v, power: power[v] });
    return deck.sort(() => Math.random() - 0.5);
}

function startGame() {
    game.deck = createDeck();
    game.trumpCard = game.deck[game.deck.length - 1]; 
    game.table = []; // Тізім: [{attack: card, defend: card/null}]
    game.winner = null;
    game.playerHand = [];
    game.botHand = [];
    fillHands();
    game.attacker = 'player'; 
}

function canBeat(attack, defend) {
    if (attack.suit === defend.suit) return defend.power > attack.power;
    if (defend.suit === game.trumpCard.suit && attack.suit !== game.trumpCard.suit) return true;
    return false;
}

function botTurn(socket) {
    if (game.winner) return;
    setTimeout(() => {
        if (game.attacker === 'player') { 
            // БОТ ҚОРҒАНАДЫ
            let pair = game.table[game.table.length - 1];
            if(pair && !pair.defend) {
                let candidates = game.botHand.filter(c => canBeat(pair.attack, c));
                candidates.sort((a,b) => a.power - b.power);
                
                if (candidates.length > 0) {
                    let card = candidates[0];
                    game.botHand.splice(game.botHand.indexOf(card), 1);
                    pair.defend = card;
                    sendUpdate(socket);
                } else {
                    takeCards('bot', socket);
                }
            }
        } else { 
            // БОТ ШАБУЫЛДАЙДЫ
            // Егер үстел бос болса немесе бәрі жабылса
            let allCovered = game.table.every(p => p.defend !== null);
            if (game.table.length === 0 || (allCovered && game.table.length < 6)) {
                let card = null;
                if(game.table.length === 0) {
                    game.botHand.sort((a,b) => a.power - b.power);
                    card = game.botHand[0];
                } else {
                    // Подкидной
                    let tableVals = new Set();
                    game.table.forEach(p => { tableVals.add(p.attack.value); if(p.defend) tableVals.add(p.defend.value); });
                    card = game.botHand.find(c => tableVals.has(c.value));
                }

                if (card) {
                    game.botHand.splice(game.botHand.indexOf(card), 1);
                    game.table.push({ attack: card, defend: null });
                    sendUpdate(socket);
                } else {
                    if(game.table.length > 0) endTurn(socket);
                }
            }
        }
    }, 1000);
}

function takeCards(who, socket) {
    let cards = [];
    game.table.forEach(p => { cards.push(p.attack); if(p.defend) cards.push(p.defend); });
    game.table = [];
    if(who === 'player') game.playerHand.push(...cards);
    else game.botHand.push(...cards);
    fillHands();
    sendUpdate(socket);
    if(game.attacker === 'bot') botTurn(socket);
}

function endTurn(socket) {
    game.table = [];
    fillHands();
    game.attacker = game.attacker === 'player' ? 'bot' : 'player';
    sendUpdate(socket);
    if(game.attacker === 'bot') botTurn(socket);
}

function fillHands() {
    while (game.playerHand.length < 6 && game.deck.length > 0) game.playerHand.push(game.deck.pop());
    while (game.botHand.length < 6 && game.deck.length > 0) game.botHand.push(game.deck.pop());
    if(game.deck.length === 0 && game.playerHand.length === 0) game.winner = 'player';
    if(game.deck.length === 0 && game.botHand.length === 0) game.winner = 'bot';
}

function sendUpdate(socket) {
    socket.emit('updateState', {
        playerHand: game.playerHand, 
        botCardCount: game.botHand.length,
        table: game.table, 
        trumpCard: game.trumpCard,
        deckCount: game.deck.length,
        attacker: game.attacker, 
        winner: game.winner
    });
}

io.on('connection', (socket) => {
    startGame();
    sendUpdate(socket);

    socket.on('playCard', (index) => {
        if (game.attacker === 'bot' && game.table.every(p => p.defend !== null)) return;
        
        let card = game.playerHand[index];
        let isValid = false;

        if (game.attacker === 'player') {
            // Шабуыл
            if (game.table.length === 0) isValid = true;
            else {
                // Подкидной
                let tableVals = new Set();
                game.table.forEach(p => { tableVals.add(p.attack.value); if(p.defend) tableVals.add(p.defend.value); });
                if (tableVals.has(card.value) && game.table.every(p => p.defend)) isValid = true;
            }
            if(isValid) game.table.push({ attack: card, defend: null });
        } else {
            // Қорғаныс
            let pair = game.table[game.table.length - 1];
            if (pair && !pair.defend && canBeat(pair.attack, card)) {
                isValid = true;
                pair.defend = card;
            }
        }

        if (isValid) {
            game.playerHand.splice(index, 1);
            sendUpdate(socket);
            botTurn(socket);
        }
    });

    socket.on('actionTake', () => { if(game.attacker === 'bot') takeCards('player', socket); });
    socket.on('actionBita', () => { if(game.attacker === 'player') endTurn(socket); });
    socket.on('restart', () => { startGame(); sendUpdate(socket); });
});

server.listen(process.env.PORT || 3000);
