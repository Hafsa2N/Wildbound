// ---------------- ZONES ----------------
// The endless run travels through ZONES that change as you go:
//
//   Emerald Trail  ->  River Crossing  ->  Ancient Ruins  ->  (again, harder)
//
// Each zone decides:
//   - what the ground is   (surface: solid 'ground', or a boardwalk over 'water')
//   - how it looks         (textures, decoration style, sky/fog palette)
//   - what you face        (pattern weights - see patterns.js)
//
// Between zones comes a TRANSITION chunk (a riverbank, a ruin gate...)
// where the ground changes and the sky colours blend from one to the next.

export const ZONES = {
    trail: {
        id: 'trail',
        name: 'Emerald Trail',
        surface: 'ground',
        ground: 'jungleGround',
        path: 'dirtPath',
        cliff: 'cliff',
        palette: {
            zenith: '#3f97ad',
            horizon: '#9fd6bb',
            below: '#4f7f62',
            sunGlow: '#fff0c2',
            ridgeNear: '#4d8d70',
            ridgeFar: '#79b59a'
        },
        // How often each pattern appears. `min` = only after this difficulty.
        patterns: {
            calm: { weight: 2 },
            ravine: { weight: 3 },
            snapjaw: { weight: 2 },
            lashLow: { weight: 1.5 },
            lashHigh: { weight: 1.5 },
            lashPair: { weight: 1, min: 0.3 },
            ropeChain: { weight: 1.2, min: 0.1 }
        }
    },

    river: {
        id: 'river',
        name: 'River Crossing',
        surface: 'water',
        ground: 'riverBank',
        path: null,               // a boardwalk instead of a dirt path
        cliff: null,
        palette: {
            zenith: '#3a9fc4',
            horizon: '#a6dcd6',
            below: '#3f7f7a',
            sunGlow: '#fff4d6',
            ridgeNear: '#4f8f86',
            ridgeFar: '#7fb8b0'
        },
        patterns: {
            calm: { weight: 1.5 },
            ravine: { weight: 4 },   // gaps in the boardwalk over open water
            ropeChain: { weight: 1.8 },
            lashLow: { weight: 1.5 },
            lashHigh: { weight: 1.5 },
            snapjaw: { weight: 0.8 }
        }
    },

    ruins: {
        id: 'ruins',
        name: 'Ancient Ruins',
        surface: 'ground',
        ground: 'ruinGround',
        path: 'stonePath',
        cliff: 'ruinCliff',
        palette: {
            zenith: '#5a98a6',
            horizon: '#bccba4',   // warmer, golden-olive haze
            below: '#626b4c',
            sunGlow: '#ffe2a6',
            ridgeNear: '#6f8763',
            ridgeFar: '#9db08a'
        },
        patterns: {
            calm: { weight: 1 },
            ravine: { weight: 3 },
            snapjaw: { weight: 2.5 },
            snapGauntlet: { weight: 1.5, min: 0.2 },
            lashPair: { weight: 1.5 },
            lashHigh: { weight: 1 },
            ropeChain: { weight: 1.2 }
        }
    }
};

export const ZONE_ORDER = ['trail', 'river', 'ruins'];

// Gameplay chunks in each zone before the next transition.
export const CHUNKS_PER_ZONE = 7;

// The pattern weights for a zone at a given difficulty (0..1).
export function patternWeights(zone, level) {
    const weights = {};
    for (const [name, rule] of Object.entries(zone.patterns)) {
        weights[name] = level >= (rule.min ?? 0) ? rule.weight : 0;
    }
    return weights;
}
