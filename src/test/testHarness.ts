import { QwenAdapter } from '../adapter/qwenAdapter';
import { FloatingPanel } from '../content/floatingPanel';
import { VTab } from '../types';

class MockQwenPage {
  private chatInput: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private uploadBtn: HTMLButtonElement;
  private fileInput: HTMLInputElement;
  private messagesContainer: HTMLElement;
  private previewArea: HTMLElement;
  private generatingSpinner: HTMLElement;
  private adapter: QwenAdapter;
  private hud: FloatingPanel;
  private currentTurn = 1;

  constructor() {
    this.chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
    this.sendBtn = document.getElementById('send-button') as HTMLButtonElement;
    this.uploadBtn = document.getElementById('upload-button') as HTMLButtonElement;
    this.fileInput = document.getElementById('file-upload-input') as HTMLInputElement;
    this.messagesContainer = document.getElementById('chat-messages-container') as HTMLElement;
    this.previewArea = document.getElementById('attachment-previews') as HTMLElement;
    this.generatingSpinner = document.getElementById('generating-indicator') as HTMLElement;

    this.adapter = new QwenAdapter(document);

    // Mount floating panel
    this.hud = new FloatingPanel(
      (partNum) => this.handleHudInsertPart(partNum),
      () => alert('Download requested from HUD!'),
      () => alert('Retry requested from HUD!')
    );
    this.hud.mount();

    this.bindEvents();
    this.initMockTabState();
  }

  private initMockTabState(): void {
    const mockTab: VTab = {
      id: 'V1',
      index: 1,
      chromeTabId: 101,
      qwenUrl: window.location.href,
      status: 'ready',
      selected: true,
      initialMessage: 'Create the following video.',
      title: 'Top 10 Ancient Mysteries',
      masterPrompt: 'Write a high-retention 4-part script with scene headings and voiceover dialogue.',
      thumbnailStatus: 'assigned',
      thumbnailName: 'thumbnail_v1.png',
      scriptStatus: 'assigned',
      scriptName: 'v1_outline.txt',
      totalParts: 4,
      currentPart: 1,
      parts: [
        { partNumber: 1, label: 'Part 1', status: 'ready', content: '', downloaded: false },
        { partNumber: 2, label: 'Part 2', status: 'waiting', content: '', downloaded: false },
        { partNumber: 3, label: 'Part 3', status: 'waiting', content: '', downloaded: false },
        { partNumber: 4, label: 'Part 4', status: 'waiting', content: '', downloaded: false }
      ],
      lastUpdated: Date.now()
    };
    this.hud.update(mockTab);
  }

  private bindEvents(): void {
    this.uploadBtn.addEventListener('click', () => this.fileInput.click());

    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files) {
        Array.from(this.fileInput.files).forEach((file) => {
          const chip = document.createElement('div');
          chip.className = 'file-chip';
          chip.textContent = `📎 ${file.name}`;
          this.previewArea.appendChild(chip);
        });
      }
    });

    this.sendBtn.addEventListener('click', () => this.handleUserSubmit());

    this.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleUserSubmit();
      }
    });
  }

  private async handleUserSubmit(): Promise<void> {
    const text = this.chatInput.value.trim();
    if (!text) return;

    // Append user message
    this.appendMessage(text, 'user');
    this.chatInput.value = '';
    this.previewArea.innerHTML = '';

    // Show generating spinner
    this.generatingSpinner.style.display = 'block';
    this.sendBtn.disabled = true;

    // Simulate AI generation delay
    await new Promise((resolve) => setTimeout(resolve, 1200));

    // Generate response with PART headers
    let responseText = '';
    if (text.includes('Part 2')) {
      this.currentTurn = 2;
      responseText = `Sure! Here is Part 2 of the script:\n\nPART 2: THE GREAT PYRAMID\n[Scene: Drone shot over Giza at sunrise]\nHost (VO): For over four thousand years, the Great Pyramid of Giza was the tallest man-made structure on Earth.\n[SFX: Wind howling through the desert]\nNarrator: But modern scans have revealed hidden voids that defy conventional explanations.`;
    } else if (text.includes('Part 3')) {
      this.currentTurn = 3;
      responseText = `Here is Part 3 of the script:\n\nPART 3: THE NAZCA LINES\n[Scene: Aerial view of Peru desert plateau]\nHost (VO): Etched across hundreds of square miles in the high desert of Peru lie giant geoglyphs.\nNarrator: Visible only from the sky, who were these enormous drawings meant for?`;
    } else if (text.includes('Part 4')) {
      this.currentTurn = 4;
      responseText = `Here is Part 4:\n\nPART 4: THE ATLANTIS PUZZLE\n[Scene: Underwater ruins off the coast of Bimini]\nHost (VO): Plato described a lost civilization possessing technology far ahead of its era.\nNarrator: Could modern deep-sea sonar finally uncover the truth? Let us know your thoughts in the comments!`;
    } else {
      // First turn: generates Part 1 and outlines 4 parts total
      this.currentTurn = 1;
      responseText = `Certainly! I will produce a 4-part video script based on your title and master instructions.\n\nPART 1: THE LOST CITY OF DWARKA\n[Scene: Underwater footage with misty blue light]\nHost (VO): Beneath the waters of the Arabian Sea lies one of the world's oldest submerged cities.\nNarrator: Legends claimed it was merely myth, until marine archaeologists discovered massive stone anchors dating back thousands of years.\n[Visual: 3D reconstruction of stone walls]`;
    }

    this.generatingSpinner.style.display = 'none';
    this.sendBtn.disabled = false;
    this.appendMessage(responseText, 'assistant');

    // Update HUD with detected parts
    const detection = this.adapter.extractParts(this.currentTurn);
    const updatedTab: VTab = {
      id: 'V1',
      index: 1,
      chromeTabId: 101,
      qwenUrl: window.location.href,
      status: this.currentTurn >= 4 ? 'completed' : 'ready',
      selected: true,
      initialMessage: '',
      title: 'Top 10 Ancient Mysteries',
      masterPrompt: 'Master prompt applied.',
      thumbnailStatus: 'uploaded',
      scriptStatus: 'uploaded',
      totalParts: 4,
      currentPart: this.currentTurn,
      parts: [
        { partNumber: 1, label: 'Part 1', status: 'done', content: 'Part 1 content', downloaded: false },
        { partNumber: 2, label: 'Part 2', status: this.currentTurn >= 2 ? 'done' : 'ready', content: this.currentTurn >= 2 ? 'Part 2 content' : '', downloaded: false },
        { partNumber: 3, label: 'Part 3', status: this.currentTurn >= 3 ? 'done' : (this.currentTurn === 2 ? 'ready' : 'waiting'), content: this.currentTurn >= 3 ? 'Part 3 content' : '', downloaded: false },
        { partNumber: 4, label: 'Part 4', status: this.currentTurn >= 4 ? 'done' : (this.currentTurn === 3 ? 'ready' : 'waiting'), content: this.currentTurn >= 4 ? 'Part 4 content' : '', downloaded: false }
      ],
      lastUpdated: Date.now()
    };
    this.hud.update(updatedTab);
  }

  private handleHudInsertPart(partNum: number): void {
    this.adapter.insertText(`Please write Part ${partNum} script now.`);
    this.sendBtn.click();
  }

  private appendMessage(text: string, role: 'user' | 'assistant'): void {
    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${role}-message`;
    bubble.setAttribute('data-role', role);
    bubble.textContent = text;
    this.messagesContainer.appendChild(bubble);
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }
}

document.addEventListener('DOMContentLoaded', () => new MockQwenPage());
