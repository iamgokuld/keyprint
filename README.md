# KeyPrint

KeyPrint is a browser demo of keystroke dynamics. You type the passphrase `.tie5Roanl` ten times, the page builds a profile of your timing, and then it tries to tell your later attempts apart from someone else typing the same password.

Live site: https://iamgokuld.github.io/keyprint/

## What it measures

For each of the 11 keys (`.tie5Roanl` plus Return) the page records when the key went down and when it came up. From that it computes 31 features:

- 11 hold times (how long each key is held)
- 10 press-to-press times (one key down to the next key down)
- 10 release-to-press times (one key up to the next key down)

A typo, Backspace or leaving the field throws the attempt away.

## How it decides

Three detectors score a new attempt against your ten enrollment samples:

- Scaled Manhattan: per-feature distance from your mean, scaled by your usual spread.
- Mahalanobis: distance from your mean that accounts for features moving together. The covariance is shrunk toward the diagonal because 10 samples are not enough to invert a 31x31 matrix.
- Nearest neighbor: Mahalanobis distance to your closest single sample.

Each detector's threshold comes from leave-one-out scores on your own samples, set to a target false-reject rate (5% by default). An attempt is accepted when 2 of the 3 detectors pass.

On a touch screen the page uses its own on-screen keypad instead of the phone keyboard, because soft keyboards report unreliable key timings. It also records where each tap lands on the key, which adds 22 position features. Phone and keyboard profiles are kept separate.

## Benchmark

The Benchmark tab compares the detectors against Killourhy and Maxion's CMU keystroke dataset (DSN 2009): equal-error rates, ROC curves, error vs. enrollment size, and per-subject spread. With 10 training reps the mean EER is roughly twice what it is with 200, so expect the demo to reject you now and then.

To rerun it from the command line:

```
./scripts/get-data.sh   # downloads DSL-StrongPasswordData.csv from cs.cmu.edu
npm run bench
```

## Running locally

Everything is in `index.html`, plain JavaScript with no build step. Open it in a browser.

Tests need Node 18 or newer:

```
npm test        # detector, capture and touch tests
npm run e2e     # browser tests, needs Playwright
```

## Limits

This is a demo of a research technique, not an authentication system. Typing rhythm drifts between days and keyboards, and a profile from one sitting will reject you more often later. Timings and profiles stay in your browser's localStorage; export and import are JSON files you control.

## License

MIT, see [LICENSE](LICENSE).
