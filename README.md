# Shove

A Static Crown game

Play at https://samakil.github.io/shove/ — open that page on two browsers (or a phone and a computer), tap **Create room** on one and **Join** with the 4-character code on the other (or use the host’s copy-link / `?room=CODE` URL). First to 3; knock them off the stage.

## QA

Run the dependency-free regression checks with:

```sh
node qa-harness.js
```

GitHub Actions runs the same checks on every push to `main` and on pull requests.
