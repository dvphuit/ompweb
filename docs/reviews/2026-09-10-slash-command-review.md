# Review + fix: slash commands trong composer omp-web

Ngày review: 2026-09-10 · Branch `arena/01a08bc7-ompweb` @ `1f73a57` · Phạm vi: slash command ở composer (web-native + session/action commands).

## 0. Kết luận

**Các lệnh hoạt động.** 10 lệnh web (`/goal /plan /review /fix /test /explain /simplify /commit /advisor /loop`) expand đúng ở **cả hai đường**: gửi khi idle và queue khi agent đang chạy. 5 lệnh session (`/compact /reload /name /session /copy`) dispatch đúng vào kênh RPC `sendAgentCommand`.

Review tìm ra 9 vấn đề; **8 đã sửa trong thay đổi này**, 1 còn lại là hạn chế có chủ đích (ghi ở §5).

| # | Vấn đề | Trạng thái |
|---|--------|-----------|
| F1 | `/goal clear` (cả `done/finish/remove/off`) chỉ hoạt động khi idle → khi queue nó hóa thành prompt "Work toward this goal… clear" | ✅ Đã sửa (`sendQueued` đi qua dispatcher) |
| F2 | `/goal`, `/plan` mất side-effect UI (goal chip / active plan) khi queue | ✅ Đã sửa |
| F3 | Có attachment → **toàn bộ** slash dispatch bị bỏ qua, `/goal …` và `/compact` bị gửi nguyên văn cho model | ✅ Đã sửa (web command vẫn expand + giữ attachment; session command từ chối kèm thông báo) |
| F4 | `/copy` gọi thẳng `navigator.clipboard` → lỗi trên origin không secure (http://IP-LAN) | ✅ Đã sửa (dùng `copyText()` có fallback) |
| F5 | `/Goal`, `/GOAL` không match → text slash literal tới model | ✅ Đã sửa (match không phân biệt hoa thường ở lookup, gate và palette) |
| F6 | `/loop`: `0` → âm thầm 3 lần; `/loop 4` (chỉ count) → task tên "4" | ✅ Đã sửa (usage-error) + số nhiều/đúng ngữ pháp ("up to 1 attempt") |
| F7 | 15 tên lệnh web che hoàn toàn command cùng tên của user; `aliases`/`input.hint` của omp bị bỏ | ✅ Đã sửa (user command thắng ở cả palette lẫn dispatch; hint + alias được giữ và tìm kiếm được) |
| F8 | Khi agent đang chạy, mọi builtin biến mất khỏi palette dù dispatch vẫn chạy | ✅ Đã sửa (lệnh compose prompt vẫn hiện; chỉ session command bị ẩn) |
| F9 | Comment mâu thuẫn: "omp builtins still work when typed" vs "forwarded as literal text" | ✅ Đã sửa comment cho đúng với hành vi đã kiểm chứng; phần cần omp thật để xác nhận ghi ở §5 |

## 1. Cách kiểm chứng

```bash
node --experimental-strip-types --test lib/web-slash-commands.test.mjs     # 8/8
node --experimental-strip-types --test components/ChatInput-slash-commands.test.mjs  # 4/4 (mới)
node --experimental-strip-types --test hooks/useAgentSession.test.mjs       # 6/6
npm test            # 604 tests: 603 pass, 0 fail, 1 skipped (trước fix: 589/588)
npm run typecheck   # ✓
npm run lint        # ✓
```

Bốn harness tạm (jsdom + jiti, đã xoá sau khi chạy) mount `ChatInput.tsx` **thật** rồi dispatch `input`/`keydown Enter`, với một stub dispatcher mô phỏng đúng thứ tự của `useAgentSession.handleBuiltinSlashCommand`:

- harness #1 (trước fix): 15 check — định vị hành vi hiện tại, tìm ra F1/F3/F5.
- harness #2 (sau fix): 12/12 — `/goal clear` khi queue không còn gửi prompt; `/plan` khi queue được expand qua transport `queue`; `/loop 4` báo usage; `/GOAL` được dispatch; user-defined `/review` thắng ở cả dispatch và palette.
- harness #3 (attachment): 6/6 — `/goal` + file → prompt đã expand **và** giữ nội dung file; `/compact` + file → từ chối, giữ input; `/tdd` (của user) + file → gửi nguyên văn kèm file; prompt thường không đổi.
- harness #4 (sau tự review lần 2): 13/13 rồi 9/9 — `/goal clear` + attachment xoá goal mà không gửi gì; `/plan` + attachment set plan state **trước** khi deliver; composer không có hook vẫn expand `/explain`, báo usage cho `/fix`, và giữ nguyên `/vibe`.

Cộng thêm 1 probe thuần logic ~45 input qua `expandWebSlashCommand()` và kiểm tra key i18n (141 key `chatInput.*` có mặt ở cả 3 locale — giờ có test chốt lại).

## 2. Hành vi sau khi sửa

| Lệnh | Idle | Agent đang chạy | Có attachment |
|---|---|---|---|
| `/goal <t>`, `/plan <t>` | expand + set goal chip/plan | expand **qua queue** + set goal chip/plan | expand, set goal chip/plan, rồi gửi kèm attachment |
| `/goal clear\|done\|finish\|remove\|off` | xoá goal | xoá goal, không queue gì | xoá goal, không gửi gì |
| `/review /fix /test /explain /simplify /commit /advisor /loop` | expand | expand qua queue | expand, giữ attachment |
| `/advisor` khi toggle tắt | chặn + toast | chặn **trước** khi expand | chặn (gate composer, không bỏ qua đường attachment) |
| `/compact /reload /name /session /copy` | RPC `sendAgentCommand` | forward nguyên văn cho omp | từ chối + giải thích (`chatInput.commandNoAttachments`) |
| Lệnh của user (extension/prompt/skill) trùng tên | forward nguyên văn | forward nguyên văn | forward nguyên văn |
| `/GOAL`, `/Compact` | dispatch như chữ thường | như chữ thường | — |
| `/vibe`, `/unknown`, `/home/x`, `//x`, `/**b**` | forward nguyên văn (không đổi) | — | — |

## 3. Thay đổi cụ thể

**`lib/web-slash-commands.ts`**
- Lookup map theo tên đã lowercase → `/Goal` hoạt động (F5); alias vẫn **không** được nhận (có test chốt).
- Thêm `validateArgs?` vào `WebSlashCommandDef`; `expandWebSlashCommand` trả `usage-error` khi args không dùng được.
- `parseLoopArgs()`: count phải ≥1 và phải có task; clamp tối đa 10; `/loop 1` → "up to 1 attempt" (F6).
- Export `slashCommandNameOf(text)` — một cách duy nhất để lấy tên lệnh, dùng chung cho composer và hook.

**`components/ChatInput-slash-commands.ts`**
- `ACTION_SLASH_COMMAND_NAMES` / `isActionSlashCommand()` tách nhóm session command khỏi nhóm prompt-composing.
- `SlashCommandPaletteItem.aliases` + `slashCommandMatchesQuery()`; `slashMatchRank` xếp alias ngang prefix của tên, cao hơn match ở mô tả, và tự lowercase query (F7).

**`components/ChatInput.tsx`**
- `handleSend`: nhánh slash giờ keyed trên *ownership* (`isClientOwnedSlashCommand`) chứ không phải "không có attachment"; attachment + web command → expand rồi gửi kèm file; attachment + session command → từ chối; gate advisor áp dụng cho cả đường tự xử lý (F3).
- `sendQueued`: không tự expand nữa — gọi `onBuiltinCommand(msg, { queue })` để dispatcher giữ toàn bộ ngữ nghĩa, composer chỉ cung cấp transport; session command vẫn forward nguyên văn; command của user giữ nguyên text (F1/F2).
- Palette: ẩn bản copy của client khi user có lệnh trùng tên; không còn xoá lệnh của user; hiện lệnh compose prompt khi đang chạy, chỉ ẩn session command (F7/F8).

**`hooks/useAgentSession.ts`**
- `handleBuiltinSlashCommand(text, { queue? })`; rollback goal/plan khi prompt bị từ chối; `/goal clear` xử lý trước khi chọn transport (F1/F2).
- Kiểm tra `slashCommands` trước `switch`: command user định nghĩa thắng (F7).
- `commandName` lowercase (F5); `/copy` dùng `copyText()` (F4).

**`hooks/useAgentSession-stream.ts`**
- `toSlashCommandInfo` giữ `input.hint` → `argumentHint` và `aliases` (F7); comment sửa lại cho đúng (F9).

**i18n**: thêm `chatInput.commandNoAttachments` cho `en`/`ja`/`zh-CN` + test parity `chatInput.*`.

**Tests**: `lib/web-slash-commands.test.mjs` (+case hoa thường, +validation `/loop`), `components/ChatInput.test.mjs` (thay test slice-giòn bằng 5 test contract + parity i18n), `hooks/useAgentSession.test.mjs` (+4 test source-contract), `components/ChatInput-slash-commands.test.mjs` (mới, 4 test).

## 4. Giới hạn của việc kiểm chứng

- Sandbox **không có binary `omp`** (`which omp` → not found) và không có credential model → 5 session command và claim "TUI-only builtins" chỉ verify được tới tầng wiring: composer → `sendAgentCommand` → `app/api/agent/[id]` → switch trong `lib/rpc-manager.ts` (đủ `compact`, `reload`, `set_session_name`, `get_session_stats`, `get_last_assistant_text`, `get_commands`).
- `npm run build` fail trong sandbox **vì môi trường**: `next/font` không fetch được Google Fonts. `typecheck`/`lint`/`test` đều pass.
- jsdom không có SSE/fetch thật: harness verify dispatch của composer, không verify render palette với danh sách lệnh thật từ omp.

## 5. Tự review lần 2 (review lại chính patch của mình)

Đọc lại diff thấy 8 vấn đề trong patch lượt 1 — tất cả đã sửa trong cùng commit:

1. **F1 mới sửa được một nửa.** `/goal clear` **kèm attachment** vẫn sinh prompt "Work toward this goal… clear", vì composer tự expand mà không hỏi dispatcher. Sửa: composer luôn gọi dispatcher và chỉ tự cung cấp *transport* khi nó phải tự gửi (attachment, hoặc không có hook).
2. **Tên `queue` sai phạm vi.** Transport cùng lúc dùng cho "gửi ngay kèm file" → đổi thành `deliver`, docstring nói rõ hai lý do.
3. **Composer không có dispatcher vẫn rò rỉ slash text** (`/goal x` đi nguyên văn vào model). Thêm nhánh fallback: expand lệnh mình sở hữu, báo usage khi thiếu args, còn lệnh của omp thì giữ nguyên.
4. **`copyText()` reject không kèm giá trị** → notice của `/copy` hiện chữ "undefined" khi clipboard lỗi. Giờ reject một `Error` có message.
5. **Ba bản sao của cùng một regex** parse dòng lệnh (lib / hook / composer) — đó chính là cơ chế sinh ra F1. Gom về `parseSlashCommandLine(text) → { name, args }`; composer và hook dùng chung, có test cấm dispatcher tự parse lại.
6. **Tin type của dữ liệu đọc từ pipe**: `input.hint`/`aliases` do omp gửi qua stdio được gọi `.trim()`/`.toLowerCase()` ngay → một field lệch kiểu sẽ làm crash cả palette. Thêm guard `typeof`.
7. **Code chết do refactor để lại:** preflight kích thước thứ hai trong `handleSend` không bao giờ chạy (`composeMessageWithTextAttachments(prompt, [])` trả nguyên văn, nên lần kiểm tra đầu đã phủ cả hai nhánh); `commandName !== null` và `msg.startsWith("/"))` cạnh predicate đã tự xử lý null; `ACTION_SLASH_COMMAND_LOOKUP` không cần export.
8. **Test giòn**: test cũ so chuỗi `"/plan "` (không trim) và test nguồn mới của mình cũng tham chiếu biến đã đổi tên. Đổi sang bất biến (ownership → transport → thứ tự gate), sửa assert theo tên mới.

## 6. Còn lại (có chủ đích / cần bạn quyết)

1. **`/compact` khi agent đang chạy**: vẫn là text nguyên văn trong queue, omp chỉ chạy nó nếu prompt path của họ xử lý slash — đó chính là F9; cần một lần xác nhận với `omp` thật để hoặc (a) bỏ hẳn việc cho queue session command, hoặc (b) ghi rõ trong palette.
2. Palette chèn tên chính, không chèn alias (alias chỉ để tìm kiếm) — chủ đích, vì omp accept cả hai.
3. Cùng một lỗi usage nhưng hiển thị bằng **notice** (do dispatcher báo ở đường text-only) và bằng **toast** (do composer báo ở đường attachment) — composer không có `addNotice`. Thống nhất được nếu chuyển cả hai về một kênh thông báo.
4. Phát hiện ngoài phạm vi (không sửa): `fileExplorer.noChangedFiles` và `messageView.taskSubagents` thiếu ở `ja`/`zh-CN`; `fileExplorer.newlyUploaded` tồn tại trong `ja` nhưng không có trong `en`.
