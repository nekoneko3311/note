# Windowsで使う方へ（ベータ）

**このキットはMacで動作確認をしています。Windowsは未確認です。**
動くように作ってありますが、途中で詰まることがあります。そのときは、画面に出ている文章を
そのままClaudeに貼って相談してください。

> **先に `00_はじめに読む注意書き.md` を読んでください（3分ほど）。**
> このキットの版と変更履歴は `VERSION.md` にあります。

---

## 導入の手順は、Macと同じです

`はじめにお読みください.md` の「2. 導入する」をそのまま読んでください。**やることは3ステップです。**

1. Claudeのアプリを開いて「Code」タブを選ぶ
2. 「フォルダを選択」で、この `note-kit` フォルダを選ぶ
3. 「**セットアップして**」と打つ

**PowerShell（青い画面）をあなたが開くのは、次の2つの場合だけです。** それ以外のコマンドはClaudeが実行します。

- Codex（画像づくりの道具）を入れる人だけ：初回のログインで1回、`codex` と打ちます
- 「スクリプトの実行が無効」と出たときだけ：1行打ちます（下の「1.」）

Claudeが命令を動かす仕組みは、**Git for Windows（Git Bash）が入っていればそれ、無ければPowerShell** です（Claude Codeの公式の説明）。
どちらで動いていても、Windows向けのやり方への読み替えは案内役のAIがやります。

置き場所だけ、Macと表記が違います。

- 置き場所：`C:\Users\あなたの名前\note-kit`（ユーザーフォルダの直下）
- **OneDriveの中には置かないでください。** 同期の途中でファイルが読めなくなることがあります
- `note-kit` の中にもうひとつ `note-kit` が入っていたら、内側のほうを使ってください

---

## Windowsで詰まりやすいところ

**以下はWindowsで起きうることの想定です。実機での確認はまだできていません。**
当てはまらないこともありますし、ここに無い症状が出ることもあります。

### 1. 「このシステムではスクリプトの実行が無効になっている」と出た

PowerShellの初期設定で止められています。**Claudeに「この文章が出ました」と貼れば案内してくれます。**
自分でやる場合は、PowerShellで次を1回だけ実行してください（管理者権限は不要です）。

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

「変更しますか」と聞かれたら `Y` を入れてEnter。そのあと、導入をやり直します。

### 2. Node.jsが見つからないと言われた

入っていないか、入れた直後でまだ認識されていません。
[nodejs.org](https://nodejs.org/ja) の大きいボタン（LTS）から入れて、**Claudeを一度閉じて開き直して**ください。

### 3. フォルダの場所が思ったところにない

OneDriveを使っていると、デスクトップや書類の実際の場所が `C:\Users\名前\OneDrive\...` に変わっています。
キットは**ユーザーフォルダの直下**に置いてください。分からなくなったらClaudeに「**キットの場所を確認して**」と伝えます。

### 4. ブラウザの部品のダウンロードが終わらない

300MBほど（置くと500MB以上）をダウンロードします。回線によっては5分以上かかります。
止まったように見えても、**10分は待ってください。**

### 5. 画面のスクリーンショットの撮り方がMacと違う

記事に「操作画面」を入れるとき、**Webページなら、キットが自分で撮ります**（あなたの操作は不要です）。

アプリの画面など、Web以外を撮ってほしいときは、あなたが撮って場所を伝えてください。

- **`Windows` キー ＋ `PrintScreen`** … 画面全体が `ピクチャ\スクリーンショット` に自動保存されます（ファイルになるので、いちばん扱いやすい）
- **`Windows` キー ＋ `Shift` ＋ `S`** … 範囲を選んでコピー。ペイントなどに貼り付けて保存します

---

## やめたくなったら

**Claudeに「note-kitをやめたい」と伝えてください。** 手順を実行してくれます。

自分でやる場合は、PowerShellで上から順に実行します。ユーザーフォルダの直下に
「note-kit-削除予定」というフォルダを作って、そこへまとめます。

```powershell
New-Item -ItemType Directory -Force "$HOME\note-kit-削除予定" | Out-Null
```

```powershell
Move-Item "$HOME\.claude\skills\note-auto","$HOME\.claude\skills\note-write","$HOME\.claude\skills\note-outline","$HOME\.claude\skills\note-image","$HOME\.claude\skills\note-toukou" "$HOME\note-kit-削除予定\" -ErrorAction SilentlyContinue
```

Claudeで `note-kit` フォルダを開いたままだと、次の移動が失敗することがあります。先にClaudeで別のフォルダを開き直すか、Claudeを閉じてから実行してください。

```powershell
Move-Item "$HOME\note-kit" "$HOME\note-kit-削除予定\"
```

最後に、`C:\Users\あなたの名前\note-kit-削除予定` フォルダを右クリックして削除してください（ごみ箱に入ります）。

**ログイン状態のファイルは、ごみ箱を空にするまで使える状態で残ります。** やめたら、ごみ箱を空にしてください。

**noteに作った下書きは消えません。** 不要なものは、noteの下書き一覧から手で消してください。

**やめても残るもの**（`%USERPROFILE%` は `C:\Users\あなたの名前` のことです）

- ブラウザの部品（300MBほど。置くと500MB以上）：`%USERPROFILE%\AppData\Local\ms-playwright`
- Codex本体とそのログイン（Codexを入れた人だけ）：`%USERPROFILE%\.codex`
- 導入でつまずいたときだけ行う設定（npmの置き場の設定）
- 手順書の控え（導入のときに控えを取った人だけ）：`%USERPROFILE%\.claude\skills-backup-日付`。元の手順書は、ここから戻せます
- 新しい版に入れ替えたときの控え（入れ替えた人だけ）：`%USERPROFILE%\note-kit-backup-日付`
- Claudeの会話記録：`%USERPROFILE%\.claude\projects`
- スクリプト実行の許可（上の「1.」で許可した人だけ）

---

## PowerShellで動く場合の読み替え

`はじめにお読みください.md` の巻末「付録：自分でコマンドを打ちたい人へ」は、Macの書き方です。
Claudeの命令がPowerShellで動くとき（Git for Windowsが入っていないとき）や、自分でPowerShellに打つときは、次のように読み替えてください。

| Macの書き方 | Windowsの書き方 |
|---|---|
| `~/note-kit` | `$HOME\note-kit` |
| `~/.claude/skills` | `$HOME\.claude\skills` |
| `mkdir -p ~/.claude/skills` | `New-Item -ItemType Directory -Force "$HOME\.claude\skills"` |
| `cp -r A B` | `Copy-Item -Recurse -Force A B` |
| `cd ~/note-kit/note-draft && npm install` | `cd $HOME\note-kit\note-draft` してから `npm install` |

`npm` から始まるコマンド（`npm install` `npm run doctor` `npm run draft` など）は、そのまま同じです。
