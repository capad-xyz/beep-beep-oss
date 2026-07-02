# Settings inventory (the "everything" list)

A comprehensive superset of user settings from Beeper, Element, Signal, Telegram,
and WhatsApp. Goal: see the full space, then decide what to keep/build vs cut.

Tags: **[v1]** build early (daily-driver) - **[later]** nice-to-have -
**[defer]** hard / low priority - **[diff]** our differentiator.

## 1. Account & profile
- Display name **[v1]**, avatar **[v1]**, status/bio **[later]**
- Homeserver URL / self-host **[v1] [diff]**
- Sign out this session **[v1]**, sign out all devices **[later]**
- Deactivate / delete account **[defer]**

## 2. Accounts & networks  **[diff - our core]**
- Connected accounts list, per network + per account **[v1]** (done)
- Add account via in-app login/QR **[v1]** (done for WhatsApp)
- Remove / log out an account **[v1]**
- Per-account label + colour **[v1] [diff]**, reorder **[later]**
- Bridge health + reconnect **[v1]**
- Add more networks (Signal/Telegram/IG/Messenger/Discord/Slack) **[later]**
- Unified vs per-account inbox toggle **[later] [diff]**

## 3. Notifications
- Global on/off **[v1]**; Do Not Disturb + schedule **[later]**
- Per-chat mute (1h/8h/1w/forever) **[v1]**; per-account **[later]**
- Notify on: all / mentions+replies only / none **[v1]**
- Keyword & mention highlights **[later]**
- Show message text in notification (privacy) **[v1]**
- Sound on/off + choice **[later]**; desktop/OS toggle **[v1]**
- Mobile push (FCM/APNs) **[defer - needs push infra]**
- Notify on reactions **[later]**; grouping **[later]**

## 4. Appearance
- Theme light/dark/system **[v1]**; accent colour **[later]**
- Font size **[v1]**; density compact/cozy **[later]**
- Chat wallpaper **[later]**; bubble vs flat **[later]**
- 12/24h time **[later]**; language/locale **[later]**
- Chat-list sort: recent / unread / manual **[later]**

## 5. Privacy
- Send read receipts on/off **[v1]**
- Send typing indicators on/off **[v1]**
- Share online / last-seen presence **[later]**
- Profile photo / about visibility **[later]**
- Blocked contacts **[later]**
- Disappearing messages default + per-chat **[later]**
- Screen security (block screenshots) **[later]**
- Analytics / crash-report opt-out **[v1]**

## 6. Security & encryption
- Active sessions / devices: view + revoke **[v1]**
- E2EE status per chat **[later]**
- Device verification / cross-signing **[later]**
- Key backup + recovery phrase **[later]**
- App lock (PIN / biometric) **[later]**

## 7. Chats & messaging behaviour
- Enter-to-send vs newline **[v1]**
- Archive / pin / favourite chats **[v1]**
- Link previews on/off **[later]**
- Default reaction emoji **[later]**; markdown/formatting **[later]**
- Chat folders / labels / spaces **[later]**
- Saved messages / notes-to-self **[later]**; auto-translate **[defer]**

## 8. Media & storage
- Storage usage + clear cache **[v1]**
- Media auto-download (per type, wifi/cellular) **[later]**
- Upload quality **[later]**; auto-delete old media **[later]**; data saver **[defer]**

## 9. Contacts & people
- Contact sync/import **[later]**
- Merge contacts across networks **[later] [diff]**; nicknames **[later]**

## 10. Search & organization
- Search across all chats/accounts **[v1] [diff]**
- Filter by account/network **[v1]** (done)
- Unread-only view + jump-to-unread **[later]**

## 11. Calls  **[defer]**
- Ringtone, call notifications, video quality, low-data mode.

## 12. Advanced / developer
- Homeserver / bridge config **[v1]**
- Logs / diagnostics / bug report **[later]**; experimental "labs" **[later]**
- Update channel **[later]**; import/export settings **[defer]**
- **Agent surface / MCP access** (the parked "let my agents read+reply" idea) **[defer] [diff]** - see docs/AGENT-SURFACE.md

## 13. Accessibility
- Reduce motion, high contrast, screen-reader labels, keyboard shortcuts **[later]**

## 14. Sync & devices
- Linked devices (this app's own) **[later]**
- Sync/sliding-sync tuning **[defer] [diff - the "instant sync" thesis]**
- Backup & restore **[later]**

---

**The v1 cut** (the ~18 that actually matter for a daily driver): profile
name/avatar, homeserver, account management (add/remove/label/colour), theme +
font size, per-chat mute + notify-scope + preview toggle + desktop toggle, send
read-receipts + typing toggles, active sessions, enter-to-send, pin/archive,
storage/clear-cache, and global search. Everything else is layered later.

Sources: Element, Signal, and Telegram settings documentation (2026).
