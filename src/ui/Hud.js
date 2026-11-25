// The HUD is plain HTML laid over the 3D canvas. That's normal in web
// games: the browser is already great at text and layout.
//
// Rule of thumb: only touch the DOM when a value actually CHANGES.
// Writing textContent 60 times a second for nothing is wasted work.

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds - m * 60;
    return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

const HEART_SVG = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.2 5.3 3.2
                 1.7-2 3.2-3.2 5.3-3.2 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z"/>
    </svg>`;

export default class Hud {
    constructor(maxHearts) {
        this.last = {}; // last values written, to skip unchanged updates

        this.root = document.createElement('div');
        this.root.className = 'hud';
        this.root.innerHTML = `
            <div class="hud-corner hud-left">
                <div class="hud-hearts" data-value="hearts">
                    ${Array.from({ length: maxHearts }, () => `<span class="hud-heart">${HEART_SVG}</span>`).join('')}
                </div>
                <div class="hud-pill" data-pill="coin">
                    <span class="ui-icon ui-icon-coin"></span>
                    <span data-value="coin">0</span>
                </div>
                <div class="hud-pill hud-pill-relic" data-pill="relic">
                    <span class="ui-icon-relic"></span>
                    <span data-value="relics">0</span>
                </div>
            </div>

            <div class="hud-center">
                <div class="hud-distance"><span data-value="distance">0</span><small>m</small></div>
                <div class="hud-zone" data-value="zone"></div>
                <div class="hud-chain" data-value="chain"></div>
            </div>

            <div class="hud-corner hud-right">
                <div class="hud-time" data-value="time">0:00.0</div>
                <div class="hud-wallet">
                    <span class="ui-icon ui-icon-coin ui-icon-small"></span>
                    <span data-value="wallet">0</span>
                </div>
            </div>

            <div class="hud-zone-banner" data-value="zoneBanner"></div>

            <div class="hud-hint" data-value="hint">
                <b>↑</b> run &nbsp;·&nbsp; <b>← →</b> steer
                &nbsp;·&nbsp; <b>Space</b> jump / let go
                &nbsp;·&nbsp; <b>↓</b> while running: slide
                &nbsp;·&nbsp; <b>↑ ↓</b> on a rope: pump
            </div>

            <div class="hud-banner hud-hidden" data-value="banner">
                <h2 data-value="bannerTitle"></h2>
                <div class="hud-banner-distance" data-value="bannerDistance"></div>
                <dl data-value="bannerStats"></dl>
                <p><b>Space</b> run again &nbsp;·&nbsp; <b>Esc</b> title screen</p>
            </div>
        `;

        document.body.appendChild(this.root);

        // Grab every [data-value] element once, by name.
        this.el = {};
        this.root.querySelectorAll('[data-value]').forEach((node) => {
            this.el[node.dataset.value] = node;
        });

        this.heartEls = [...this.el.hearts.children];
    }

    // Write a value into element `key` only if it changed. `format` turns
    // it into text - and only runs when the value is new, so we don't
    // build fresh strings 60 times a second for nothing.
    set(key, value, format = String) {
        if (this.last[key] === value) return;
        this.last[key] = value;
        this.el[key].textContent = format(value);
    }

    // run: { coins, relics, time }, hearts, wallet, distance (m), zone name
    update(run, hearts, wallet, distance, zoneName) {
        const toText = (n) => n.toLocaleString();
        this.set('coin', run.coins);
        this.set('relics', run.relics);
        this.set('time', Math.floor(run.time * 10), (tenths) => formatTime(tenths / 10));
        this.set('wallet', wallet, toText);
        this.set('distance', Math.floor(distance), toText);
        this.set('zone', zoneName);

        if (this.last.hearts !== hearts) {
            // A heart just broke? Shake it.
            if (this.last.hearts !== undefined && hearts < this.last.hearts) {
                const lost = this.heartEls[hearts];
                lost?.classList.remove('hud-heart-break');
                void lost?.offsetWidth;
                lost?.classList.add('hud-heart-break');
            }

            this.last.hearts = hearts;
            this.heartEls.forEach((el, i) => el.classList.toggle('hud-heart-empty', i >= hearts));
        }
    }

    // Replay a CSS animation on a pill (remove class, force reflow, re-add).
    bump(type) {
        const pill = this.root.querySelector(`[data-pill="${type}"]`);
        if (!pill) return;
        pill.classList.remove('hud-bump');
        void pill.offsetWidth;
        pill.classList.add('hud-bump');
    }

    // Floating text at a screen position, removed when its animation ends.
    popText(text, x, y, type) {
        const pop = document.createElement('div');
        pop.className = `hud-pop hud-pop-${type}`;
        pop.textContent = text;
        pop.style.left = `${x}px`;
        pop.style.top = `${y}px`;
        pop.addEventListener('animationend', () => pop.remove());
        this.root.appendChild(pop);
    }

    // The big "RIVER CROSSING" sweep when you enter a new zone.
    announceZone(name) {
        const banner = this.el.zoneBanner;
        banner.textContent = name;
        banner.classList.remove('hud-zone-banner-show');
        void banner.offsetWidth;
        banner.classList.add('hud-zone-banner-show');
    }

    // "CHAIN x3" under the distance while a chain is going.
    showChain(count) {
        const el = this.el.chain;
        el.textContent = `CHAIN x${count}`;
        el.classList.add('hud-chain-on');
        el.classList.remove('hud-bump');
        void el.offsetWidth;
        el.classList.add('hud-bump');
    }

    hideChain() {
        this.el.chain.classList.remove('hud-chain-on');
    }

    // A red flash around the screen edges when you get hurt.
    hurtFlash() {
        const flash = document.createElement('div');
        flash.className = 'hud-hurt-flash';
        flash.addEventListener('animationend', () => flash.remove());
        this.root.appendChild(flash);
    }

    hideHint() {
        this.el.hint.classList.add('hud-faded');
    }

    showHint() {
        this.el.hint.classList.remove('hud-faded');
    }

    // Hidden behind the title screen, shown during play.
    setVisible(visible) {
        this.root.classList.toggle('hud-off', !visible);
    }

    // The end of a run: how far, and what you found.
    showResults(run, distance, bestDistance, falls, wallet) {
        const newBest = distance >= bestDistance && distance > 0;

        this.el.bannerTitle.textContent = newBest ? 'New best run!' : 'The jungle wins this time';
        this.el.banner.classList.toggle('hud-banner-lost', !newBest);
        this.el.bannerDistance.innerHTML = `${Math.floor(distance).toLocaleString()}<small>m</small>`;

        const rows = [
            ['Best distance', `${Math.floor(bestDistance).toLocaleString()} m`],
            ['Time', formatTime(run.time)],
            ['Gold Coins', run.coins],
            ['Emerald Relics', run.relics],
            ['Longest chain', run.bestChain >= 2 ? `x${run.bestChain}` : '-'],
            ['Falls', falls],
            ['Coins saved', wallet.toLocaleString()]
        ];

        this.el.bannerStats.innerHTML = rows
            .map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`)
            .join('');

        this.el.banner.classList.remove('hud-hidden');
    }

    hideResults() {
        this.el.banner.classList.add('hud-hidden');
    }
}
