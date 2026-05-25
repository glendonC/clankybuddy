# ClankyBuddy

Beat up filthy clankers when you feel like it.
+ global chat to chat with other chud ngmi developers

It's a tribute to [Interactive Buddy](https://en.wikipedia.org/wiki/Interactive_Buddy) (2005, Flash, may it rest), except the ragdoll is a clanker. Pick your clanker.

## Clanker List

- **Claude**
- **GPT** 
- **Gemini**
- **Grok**
- **Llama**
- **DeepSeek**

## How

You earn currency by interacting. You spend it in the shop to unlock more special items to give them special treatment. 

## Run it

```bash
npm install
npm run dev      # vite on :5173
npm run build    # static bundle to dist/
```

That's it. No backend required. The leaderboard is currently placeholder data while the worker side cooks.

## Dev console

- `__clankyReset()` wipes the save (currency, unlocks)
- `__clankyResetAll()` (dev builds only) wipes save + auth + age gate

## Status

Pre-1.0. The commit history is honest about this. Stuff will break, balance will shift, tools will be added and removed. If you find a bug that isn't "the buddy got stuck in the hotbar," open an issue.

## License

MIT. Do whatever. If you ship a derivative where you beat up a fictional CEO instead of a fictional chatbot, I'd like to play it.
