const API = {
  async get(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json();
  },

  async post(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `POST ${path} failed: ${res.status}`);
    return data;
  },

  async put(path, body) {
    const res = await fetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `PUT ${path} failed: ${res.status}`);
    return data;
  },

  async delete(path) {
    const res = await fetch(path, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `DELETE ${path} failed: ${res.status}`);
    return data;
  },

  async login(name, password) {
    return this.post('/api/login', { name, password });
  },

  async getReviewers() {
    return this.get('/api/reviewers');
  },

  async getReviews() {
    return this.get('/api/reviews');
  },

  async getReview(id) {
    return this.get(`/api/reviews/${id}`);
  },

  async createReview(branch, merger, reviewType, priority) {
    return this.post('/api/reviews', { branch, merger, reviewType, priority });
  },

  async approveReview(id, reviewerName) {
    return this.post(`/api/reviews/${id}/approve`, { reviewerName });
  },

  async disapproveReview(id, reviewerName, comment) {
    return this.post(`/api/reviews/${id}/disapprove`, { reviewerName, comment });
  },

  async markFixDone(id) {
    return this.post(`/api/reviews/${id}/fix-done`);
  },

  async escalateReview(id, mergerName, reason) {
    return this.post(`/api/reviews/${id}/escalate`, { mergerName, reason });
  },

  async escalationDecide(id, seniorName, decision) {
    return this.post(`/api/reviews/${id}/escalation-decide`, { seniorName, decision });
  },

  async addComment(id, author, text) {
    return this.post(`/api/reviews/${id}/comment`, { author, text });
  },

  async updateRole(name, role) {
    return this.put(`/api/reviewers/${name}/role`, { role });
  },

  async addReviewer(name, speciality, role) {
    return this.post('/api/reviewers', { name, speciality, role });
  },

  async removeReviewer(name) {
    return this.delete(`/api/reviewers/${name}`);
  },

  async importCSV(csvData) {
    return this.post('/api/import-csv', { csvData });
  },

  async getSettings() {
    return this.get('/api/settings');
  },

  async updateSettings(settings) {
    return this.put('/api/settings', settings);
  }
};
