import './styles/base.css';
import './styles/hud.css';
import './styles/title.css';
import Game from './Game.js';

const container = document.getElementById('game-container');

const game = new Game(container);

// In development, expose the game so you can poke at it from the
// browser console, e.g. `game.player.position`.
if (import.meta.env.DEV) {
    window.game = game;
}
