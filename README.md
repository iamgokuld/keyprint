# KeyPrint, Your Typing Has a Fingerprint

[![Try KeyPrint live](https://img.shields.io/badge/%E2%96%B6%20Try%20KeyPrint%20live-7c3aed?style=for-the-badge&logo=github)](https://iamgokuld.github.io/keyprint/)

**Someone can learn your password. Not your rhythm.** KeyPrint learns how you type your own password and turns down anyone else who types the same one, even when they get every letter right.

**Live site:** [https://iamgokuld.github.io/keyprint/](https://iamgokuld.github.io/keyprint/)

---

## Why would anyone build this?

> **Visitor:** "I typed the right password. Why is it asking me again?"
>
> **KeyPrint:** "You typed the right letters. You did not type them *like you*."
>
> **Visitor:** "That's rude."
>
> **KeyPrint:** "It's keystroke dynamics. Very polite, very mathematical."

Passwords check what you typed. KeyPrint checks how long you held each key, how fast you moved between them, and whether you hesitated before the 'z'. Your rhythm is hard to copy by accident.

---

## What you can do

- **Create your password:** the first thing you do. It needs at least 8 characters, a capital letter, a number and a special character, and the rules tick off as you type. You also write your own security question and answer. Only salted hashes (PBKDF2-SHA-256) of the password and the answer are stored, in this browser.
- **Enroll:** type your password ten times so KeyPrint learns your rhythm. A wrong password is not counted.
- **Verify:** type it once more and three detectors vote on whether it is really you. Hand the keyboard to a friend and watch it turn them down.
- **Security question:** if the right password is rejected on rhythm, you can answer your question to get in, and then retrain on how you type now.
- **Phone mode:** on a phone, an on-screen keyboard (letters, Shift, numbers and symbols) records where your thumb lands, not just when.
- **Reset:** a Reset button on the Enroll step of Try it wipes your password, question and profile so you can start again with a new password. It is hidden during Verify.
- **Benchmark:** the Benchmark tab runs on the CMU keystroke dataset and draws an ROC curve, an enrollment curve, and per-subject EER numbers.
- **Keep it simple:** the Try it tab is the password setup, then just two steps, the password box, the verdict and Reset (Enroll only). How it works is a plain seven-step walkthrough of what happens behind the scenes, written for someone with no background.

---

## More dialogue, because typing is personal

> **Friend 1:** "Let me log in on your laptop."
>
> **Friend 2:** "Sure, my password is `Tr0ub4dor!`."
>
> **Friend 1:** "Got it. Oh, it's asking me to type it ten times first."
>
> **Friend 2:** "That's how it learns you. Don't rush it."
>
> **Friend 1:** "I'm rushing it."
>
> **Friend 2:** "It noticed."

---

## How it works

1. **Capture:** KeyPrint records the timing of each key press and release.
2. **Enroll:** after ten good attempts, it builds a profile of your typing rhythm.
3. **Verify:** three detectors score a new attempt against that profile:
   - **Scaled Manhattan** compares timing gaps, scaled to the spread you usually show.
   - **Mahalanobis** measures how far an attempt sits from your usual pattern, accounting for how the timings move together.
   - **Nearest neighbor** checks whether the attempt looks like one of your own past tries.
4. **Decide:** the page accepts the attempt when **2 of the 3** detectors pass.

The whole thing is plain JavaScript in one HTML file. No libraries, no server, and nothing leaves your browser.

---

## Run it

- **Easiest:** open the [live site](https://iamgokuld.github.io/keyprint/).
- **Locally:** clone this repo and open `index.html` in any modern browser. Double-clicking it works.

---

## A quick honesty note

KeyPrint is a **learning demo**. It is a toy for exploring keystroke dynamics, not a security product. Please do not use it to protect anything that matters, such as your bank, your email, or your secret stash of snack money.

---

*Made for curiosity. Licensed under the terms in [LICENSE](LICENSE).*
