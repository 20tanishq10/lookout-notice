import { useState } from 'react';
import { cls } from '../util';

const KEY = 'ln-tutorial-v1';

export function tutorialSeen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true; // no storage: don't nag on every load
  }
}

const SLIDES: { icon: string; title: string; body: string[] }[] = [
  {
    icon: '🔎',
    title: 'Catch Bhagodalal',
    body: [
      'Seth Bhagodalal has run off with ₹40,000 crore and is hiding somewhere in India.',
      'You each run an agency hunting him. One of you is secretly Mantri ji, who knows where he is and is helping him escape.',
    ],
  },
  {
    icon: '🔁',
    title: 'Every round has 4 steps',
    body: [
      '🌙 Night: Mantri ji secretly moves him one border (or not).',
      '🚙 Move: drive your jeep up to 2 borders. You then get a private clue.',
      '📰 Report & discuss: post your clue for everyone (true, false, or nothing), then talk it out.',
      '⚖ Act: raid a region with a warrant, or vote to seal an exit gate.',
    ],
  },
  {
    icon: '🧩',
    title: 'Your clue',
    body: [
      'Each agency gets a different clue from where its jeep stands. CBI learns how many borders away he is, NIA learns his direction, and so on.',
      'If your jeep lands right on him, you get a 🔥 Hot Trail.',
      'Mantri ji lies in his posts. Catch the clue that doesn’t fit.',
    ],
  },
  {
    icon: '🏆',
    title: 'How to win',
    body: [
      'Agencies: get a warrant on his region signed by 2 or 3 of you. A wrong raid costs each signer 3 points and a round.',
      'Mantri ji: get him out through an exit gate (the dashed rings ✈), or keep him hidden until the last round.',
      'At the end, everyone votes on who Mantri ji was.',
    ],
  },
  {
    icon: '👆',
    title: 'Tips',
    body: [
      'Tap a region on the map to see its facts and mark it ✕ ruled out, ? possible or ★ suspect. Only you see your marks.',
      'The big button at the bottom is always your next move.',
      'Tap ? at the top any time to see this again.',
    ],
  },
];

export function Tutorial({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const s = SLIDES[i];
  const last = i === SLIDES.length - 1;
  const close = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* ignore */
    }
    onClose();
  };
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="How to play">
      <div className="tutorial">
        <button type="button" className="icon-btn close" onClick={close} aria-label="Close">
          ✕
        </button>
        <div className="t-icon">{s.icon}</div>
        <h2>{s.title}</h2>
        <ul>
          {s.body.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="dots">
          {SLIDES.map((_, n) => (
            <span key={n} className={cls('d', n === i && 'on')} />
          ))}
        </div>
        <div className="row gap">
          {i > 0 && (
            <button type="button" className="btn ghost" onClick={() => setI(i - 1)}>
              Back
            </button>
          )}
          <button type="button" className="btn primary grow" onClick={() => (last ? close() : setI(i + 1))}>
            {last ? "Let's play" : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}
