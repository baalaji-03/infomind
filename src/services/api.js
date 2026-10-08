// InfoMind AI - Hybrid API & State Management Layer
// Seamlessly connects with FastAPI backend or powers standalone high-fidelity browser engine

import { DEMO_SCENARIOS } from '../data/demoScenarios.js';
import { parseUploadedFile } from './documentParser.js';

class StateService {
  constructor() {
    this.currentScenarioKey = 'ma_due_diligence';
    this.backendUrl = 'http://127.0.0.1:8000';
    this.isBackendConnected = false;
    this.activeStage = 'find'; // 'find' | 'understand' | 'organize' | 'use'
    this.activeDocId = null;
    this.searchQuery = '';
    this.selectedCompareDocIds = [];
    this.listeners = new Set();

    // Clone scenario data to allow runtime mutations (adding docs, resolving conflicts, etc.)
    this.state = JSON.parse(JSON.stringify(DEMO_SCENARIOS[this.currentScenarioKey]));
    this.activeDocId = this.state.documents[0]?.id || null;
    this.selectedCompareDocIds = this.state.documents.slice(0, 3).map(d => d.id);

    // Initial check for backend availability
    this.checkBackendConnection();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.getState());
      } catch (err) {
        console.error("State listener error:", err);
      }
    }
  }

  getState() {
    return {
      currentScenarioKey: this.currentScenarioKey,
      scenario: this.state,
      activeStage: this.activeStage,
      activeDocId: this.activeDocId,
      activeDoc: this.state.documents.find(d => d.id === this.activeDocId) || this.state.documents[0],
      searchQuery: this.searchQuery,
      selectedCompareDocIds: this.selectedCompareDocIds,
      isBackendConnected: this.isBackendConnected,
      backendUrl: this.backendUrl
    };
  }

  async checkBackendConnection() {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(`${this.backendUrl}/api/health`, { signal: controller.signal });
      clearTimeout(id);
      this.isBackendConnected = res.ok;
    } catch (e) {
      this.isBackendConnected = false;
    }
    this.notify();
    return this.isBackendConnected;
  }

  setStage(stage) {
    this.activeStage = stage;
    this.notify();
  }

  setScenario(scenarioKey) {
    if (!DEMO_SCENARIOS[scenarioKey]) return;
    this.currentScenarioKey = scenarioKey;
    this.state = JSON.parse(JSON.stringify(DEMO_SCENARIOS[scenarioKey]));
    this.activeDocId = this.state.documents[0]?.id || null;
    this.selectedCompareDocIds = this.state.documents.slice(0, 3).map(d => d.id);
    this.notify();
  }

  setActiveDoc(docId) {
    this.activeDocId = docId;
    this.notify();
  }

  setSearchQuery(q) {
    this.searchQuery = q;
    this.notify();
  }

  toggleCompareDoc(docId) {
    if (this.selectedCompareDocIds.includes(docId)) {
      if (this.selectedCompareDocIds.length > 2) {
        this.selectedCompareDocIds = this.selectedCompareDocIds.filter(id => id !== docId);
      }
    } else {
      if (this.selectedCompareDocIds.length < 4) {
        this.selectedCompareDocIds.push(docId);
      }
    }
    this.notify();
  }

  async uploadFiles(fileList) {
    const newDocs = [];
    for (const file of fileList) {
      const parsed = await parseUploadedFile(file);
      newDocs.push(parsed);
      this.state.documents.unshift(parsed);

      // Add to knowledge graph
      this.state.knowledgeGraph.nodes.push({
        id: `node-${parsed.id}`,
        label: parsed.name.slice(0, 20),
        type: 'document',
        group: 'doc',
        size: 22,
        color: '#2563EB'
      });

      // Link to a primary entity
      if (this.state.knowledgeGraph.nodes.length > 1) {
        this.state.knowledgeGraph.links.push({
          source: `node-${parsed.id}`,
          target: this.state.knowledgeGraph.nodes[0].id,
          label: 'cross-reference',
          style: 'solid'
        });
      }
    }

    if (newDocs.length > 0) {
      this.activeDocId = newDocs[0].id;
    }

    // Recalculate scenario metrics
    this.recalculateScenarioHealth();
    this.notify();
    return newDocs;
  }

  recalculateScenarioHealth() {
    const count = this.state.documents.length;
    const avgDocHealth = Math.round(
      this.state.documents.reduce((acc, d) => acc + (d.health || 80), 0) / count
    );
    const conflictPenalty = this.state.conflicts.length * 4;
    const missingPenalty = this.state.missingInformation.length * 3;
    const overall = Math.max(50, Math.min(99, avgDocHealth - Math.round(conflictPenalty / 2) - Math.round(missingPenalty / 2)));

    this.state.healthScore.overall = overall;
    this.state.healthScore.grade = overall >= 90 ? "A" : overall >= 80 ? "B" : overall >= 70 ? "C" : "D";
  }

  resolveConflict(conflictId) {
    const idx = this.state.conflicts.findIndex(c => c.id === conflictId);
    if (idx !== -1) {
      const resolved = this.state.conflicts.splice(idx, 1)[0];
      // Boost consistency score
      const consistencyPillar = this.state.healthScore.pillars.find(p => p.name === "Consistency");
      if (consistencyPillar) {
        consistencyPillar.score = Math.min(99, consistencyPillar.score + 7);
      }
      this.recalculateScenarioHealth();
      this.notify();
      return resolved;
    }
  }

  resolveMissingInfo(missingId) {
    const idx = this.state.missingInformation.findIndex(m => m.id === missingId);
    if (idx !== -1) {
      const resolved = this.state.missingInformation.splice(idx, 1)[0];
      const compPillar = this.state.healthScore.pillars.find(p => p.name === "Completeness");
      if (compPillar) {
        compPillar.score = Math.min(99, compPillar.score + 6);
      }
      this.recalculateScenarioHealth();
      this.notify();
      return resolved;
    }
  }

  // Semantic Search simulation across active documents
  searchDocuments(query) {
    if (!query || !query.trim()) return [];
    const q = query.toLowerCase().trim();
    const results = [];

    for (const doc of this.state.documents) {
      let score = 0;
      let matchedQuote = "";
      let matchedPage = 1;

      // Check title
      if (doc.name.toLowerCase().includes(q)) score += 30;

      // Check summary
      if (doc.summary.toLowerCase().includes(q)) {
        score += 40;
        matchedQuote = doc.summary;
      }

      // Check snippets
      for (const snip of doc.snippets || []) {
        if (snip.text.toLowerCase().includes(q) || snip.section.toLowerCase().includes(q)) {
          score += 50;
          matchedQuote = snip.text;
          matchedPage = snip.page;
          break;
        }
      }

      // Check entities
      for (const cat of ['financial', 'dates', 'parties', 'obligations']) {
        for (const ent of doc.entities[cat] || []) {
          if (ent.toLowerCase().includes(q)) {
            score += 35;
            if (!matchedQuote) matchedQuote = `Identified ${cat} entity: ${ent}`;
          }
        }
      }

      // If no exact match, perform fuzzy word overlap
      if (score === 0) {
        const queryWords = q.split(/\s+/).filter(w => w.length > 2);
        let overlap = 0;
        const allText = (doc.summary + " " + (doc.rawText || "")).toLowerCase();
        for (const word of queryWords) {
          if (allText.includes(word)) overlap++;
        }
        if (overlap > 0) {
          score = Math.min(75, 40 + overlap * 15);
          matchedQuote = doc.summary;
        }
      }

      if (score > 0) {
        results.push({
          docId: doc.id,
          docName: doc.name,
          docType: doc.type,
          page: matchedPage,
          confidence: Math.min(99, Math.max(65, 55 + score)),
          quote: matchedQuote || doc.summary,
          department: doc.department
        });
      }
    }

    // Sort by confidence descending
    return results.sort((a, b) => b.confidence - a.confidence);
  }
}

export const stateService = new StateService();
