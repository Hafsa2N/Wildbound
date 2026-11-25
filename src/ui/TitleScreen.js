// ---------------- TITLE SCREEN ----------------
// An HTML overlay on top of the LIVE game world (not a separate page):
// the jungle keeps moving behind it while the camera sweeps around the
// lemur. That's called an "attract mode" - it shows the game off before
// you've pressed a key.

export default class TitleScreen {
    // onStart: called when the player chooses to begin
    constructor({ worldNumber, worldName, tagline, onStart }) {

        this.root = document.createElement('div');
        this.root.className = 'title';
        this.root.innerHTML = `
            <div class="title-panel">
                <div class="title-leaf" aria-hidden="true"></div>
                <h1 class="title-logo">WILDBOUND</h1>
                <p class="title-tagline">${tagline}</p>

                <div class="title-world">
                    <span class="title-world-number">World ${worldNumber}</span>
                    <span class="title-world-name">${worldName}</span>
                    <span class="title-world-zones">Emerald Trail · River Crossing · Ancient Ruins · and on…</span>
                    <div class="title-world-stats">
                        <div class="title-best-distance" data-ref="best">No run yet</div>
                        <div class="title-best" data-ref="relics"></div>
                    </div>
                </div>

                <button class="title-start" data-ref="start" type="button">
                    Press <b>Space</b> to begin
                </button>

                <div class="title-wallet">
                    <span class="ui-icon ui-icon-coin ui-icon-small"></span>
                    <span data-ref="wallet">0</span> Gold Coins saved
                </div>

                <ul class="title-controls">
                    <li><kbd>↑</kbd> run · <kbd>←</kbd><kbd>→</kbd> steer</li>
                    <li><kbd>Space</kbd> jump · let go of a rope</li>
                    <li><kbd>↓</kbd> while running: slide</li>
                    <li><kbd>↑</kbd><kbd>↓</kbd> on a rope: pump</li>
                </ul>
            </div>
        `;

        document.body.appendChild(this.root);

        this.ref = {};
        this.root.querySelectorAll('[data-ref]').forEach((node) => {
            this.ref[node.dataset.ref] = node;
        });

        // Clicking works too, not just the keyboard.
        this.ref.start.addEventListener('click', () => onStart());
    }

    // best: { distance, relics } or null; wallet: total saved coins
    refresh(best, wallet) {
        this.ref.wallet.textContent = wallet.toLocaleString();

        this.ref.best.textContent = best?.distance
            ? `Best run ${Math.floor(best.distance).toLocaleString()} m`
            : 'No run yet';

        this.ref.relics.textContent = best?.relics
            ? `Most relics: ${best.relics}`
            : '';
    }

    show() {
        this.root.classList.remove('title-hidden');
    }

    hide() {
        this.root.classList.add('title-hidden');
    }

    get visible() {
        return !this.root.classList.contains('title-hidden');
    }
}
