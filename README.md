# Meta.ai Chrome Assistant Extension

A production-ready **Google Chrome Extension (Manifest V3)** designed to automate and orchestrate multiple Meta.ai chat tabs (`meta.ai`, `www.meta.ai`) for high-volume video script generation, tracking, and batch export.

---

## 🌟 Key Features

1. **Meta.ai Chat Duplication & State Sync**:
   - Duplicates the active Meta.ai chat tab into $N$ tabs (`1`, `5`, `10`, `20`, `50`, or custom).
   - Strictly targets genuine Meta.ai tabs (`https://chat.meta.ai/`) — never duplicates `dashboard.html`.
   - Preserves draft initial messages and pastes them into all duplicated tabs automatically with delayed retries.
   - Assigns sequential labels: `V1, V2, V3... Vn`, maintaining internal Chrome Tab ID mappings.
   - Anti-bot human pacing: Staggers tab execution with randomized human delays (1.2s - 2.5s) to avoid bot flags.

2. **Sequential Asset & Input Management**:
   - **Title Manager**: Option A (TXT file upload) and Option B (Direct paste). Strips redundant numbering prefixes (`V1 - `, `1. `, `#1 `) to normalize titles.
   - **Title Range Slicing**: When assigning titles to a range (e.g., $V1–V10$), excess titles beyond the range are strictly sliced out and discarded.
   - **Dynamic Title Insertion**: The title is dynamically inserted at markers such as `My Version of Title:`, `My Title:`, or `[TITLE]`. Defaults to `My Version of Title: {title}\n\n{masterPrompt}`.
   - **Master Prompt**: Centralized textarea + **TXT file upload button**.
   - **Filtered Table View**: "Show Selected Only" toggle to inspect only targeted tabs (e.g. $V1–V10$) without unselected tabs cluttering the view.
   - **Thumbnail Manager**: Multi-file dropzone. Auto-maps files (`Thumbnail 1.png`, `V2.jpg`, etc.) sequentially to `V1, V2...` with manual replacement support.
   - **Script Manager**: Multi-file dropzone for `TXT` (mandatory), `DOCX`, or `PDF`. Auto-maps `V1 Script.txt`, `Script 2.txt` to corresponding tabs.
   - **4 Required Inputs Validation**: Validates Title ✓, Master Prompt ✓, Thumbnail ✓, and Script ✓ before allowing execution. Clearly displays missing assets.

3. **Automation & Execution Engine**:
   - **Execution Controls**: `RUN ALL`, `RUN SELECTED`, `PAUSE ALL`, `RESUME ALL`, `STOP`, and `RETRY FAILED`.
   - **Concurrency Control**: Configurable queue (1, 2, 3, 5 concurrent tabs) to prevent browser memory spikes and freezing.
   - **Meta.ai DOM Adapter**: Centralized selector engine with multi-level fallbacks for textarea/contenteditable inputs, send buttons, file attachment elements, and generation indicators.

4. **Script Part Detection & Sequential Generation**:
   - Automatically detects generated parts (`PART 1`, `Part 01`, `### Part 2`, `Part 1 of 4`).
   - Cleans UI noise, markdown wrappers, and assistant preambles while preserving formatting and dialogue.
   - Tracks part progression (`P1 ✓ Done`, `P2 ⏳ Ready`, `P3 ○ Waiting`).
   - Sequential insertion: Triggers `Write Part {n} Script` into the chat input with one click or automatically.

5. **In-Page Floating Status HUD**:
   - Injected into the bottom-right corner of each managed Meta.ai tab.
   - Displays tab ID (`V1`), asset checklist, part progress, status badges, and action buttons (`Write Part X Script`, `Download Parts`).
   - Syncs in real time with the extension dashboard.

6. **Batch Download Manager & ZIP**:
   - Names every generated script file strictly as `V{i} P{j}.txt` (e.g., `V1 P1.txt`, `V1 P2.txt`).
   - Individual download buttons for each completed part.
   - **DOWNLOAD ALL**: Triggers download of all completed parts using `chrome.downloads`.
   - **Download All as ZIP**: Bundles all generated files into `meta_scripts_YYYY-MM-DD.zip` using JSZip.

7. **Activity Log & Human-Readable Error Diagnostics**:
   - Color-coded logs (`INFO`, `SUCCESS`, `WARNING`, `ERROR`) with timestamp and tab ID.
   - Structured diagnostic cards with:
     - **Problem**: Exactly what went wrong.
     - **Why**: Likely root cause.
     - **Solution**: Step-by-step resolution.
     - **[Retry]** button for immediate retry.
   - **Export Activity Log**: Exports full log stream to `meta_activity_log_YYYY-MM-DD.txt`.

8. **Developer Debug Mode**:
   - Real-time JSON state inspection, selector resolution, and retry counters.

---

## 📁 Project Architecture

```
├── manifest.json              # Chrome Manifest V3 configuration
├── package.json               # Dependencies & scripts
├── tsconfig.json              # TypeScript configuration
├── vite.config.ts / build.js  # Multi-entry build pipeline
├── public/
│   └── icons/                 # Extension icons (16, 32, 48, 128)
├── src/
│   ├── types/index.ts         # Central TypeScript interfaces & message schemas
│   ├── adapter/
│   │   ├── selectors.ts       # Priority fallback DOM selectors for Meta.ai
│   │   └── metaAdapter.ts     # Input insertion, file attach, response extraction
│   ├── background/
│   │   └── serviceWorker.ts   # Tab manager, queue orchestrator, state persistence
│   ├── content/
│   │   ├── contentScript.ts   # Tab controller & runtime message receiver
│   │   ├── floatingPanel.ts   # In-page floating HUD component
│   │   └── floatingPanel.css  # Floating HUD styling
│   ├── storage/
│   │   └── db.ts              # IndexedDB binary asset storage & local state sync
│   ├── utils/
│   │   ├── normalizer.ts      # Title numbering cleaner & range parser
│   │   ├── partDetector.ts    # Regex engine for multi-part detection
│   │   ├── diagnostics.ts     # Human-readable Problem/Why/Solution generator
│   │   └── fileHelper.ts      # File mapping, TXT creation & JSZip bundler
│   ├── dashboard/
│   │   ├── dashboard.html     # Full-page management dashboard
│   │   ├── dashboard.css      # Modern dashboard stylesheet
│   │   ├── dashboard.ts       # Dashboard UI controller
│   │   ├── popup.html         # Quick popup window
│   │   ├── popup.ts           # Popup controller
│   │   └── sidepanel.html     # Chrome side-panel interface
│   └── test/
│       ├── mockMeta.ai.html      # Local mock Meta.ai environment
│       ├── testHarness.ts     # Mock Meta.ai controller & response streamer
│       └── unitTest.ts        # Unit test suite (normalizer, detector, zip)
└── dist/                      # Production-ready extension bundle
```

---

## 🚀 Installation Instructions

1. **Build the extension** (already compiled in `dist/`):
   ```bash
   npm run build
   ```
2. **Open Google Chrome** and navigate to:
   ```
   chrome://extensions
   ```
3. Enable **Developer mode** via the toggle switch in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select the **`dist`** folder inside this project directory:
   `/Users/shaddo/Documents/antigravity/meta extention assistent/dist`
6. The extension **Meta.ai Chrome Assistant** is now installed and active!

---

## 🧪 Testing & Verification

### Running Automated Tests
Run the unit test suite covering title normalization, part detection, file mapping, diagnostic errors, and ZIP bundling:
```bash
npm test
```
*Output: 9 passing tests in ~12ms.*

### Testing with Local Mock Meta.ai Environment
To test multi-tab automation and floating HUD interactions without logging into Meta.ai:
1. In Chrome, open:
   ```
   chrome-extension://<EXTENSION_ID>/mockMeta.ai.html
   ```
2. The mock page mirrors Meta.ai's DOM structure (input box, send button, attachment preview chips, streaming response, and the floating status box in the lower-right corner).
3. Open the **Full Dashboard** (`chrome-extension://<EXTENSION_ID>/dashboard.html` or via popup).
4. Run tab duplication, assign titles, apply master prompt, and click **RUN ALL**.

### Testing with Live Meta.ai Chat
1. Navigate to [https://chat.meta.ai](https://chat.meta.ai) and log in.
2. Type an optional initial prompt in the chat box (e.g. `Create videos according to instructions`).
3. Click the **Meta.ai Assistant** extension icon in the toolbar, or open the **Full Dashboard**.
4. Click **Duplicate Chats** (choose `5` or `10`).
5. In **Section 3**, paste 5 titles and click **Assign Titles to Tabs**.
6. In **Section 4**, enter your master prompt and click **Apply to All Managed Tabs**.
7. In **Section 5 & 6**, drop thumbnails and script files.
8. Verify that all tabs switch to **STATUS: READY**.
9. Click **RUN ALL**. Observe real-time logs, part detection, and floating HUD updates.
10. Once generation finishes, go to **Section 9** and click **DOWNLOAD ALL AS ZIP**!
