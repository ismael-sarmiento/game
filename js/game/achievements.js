// Achievements: small goals that reward exploring Neo Academia. Unlocked ones are saved in this browser.
export const ACHIEVEMENTS = ['firstRide', 'speed100', 'nightDrive', 'storm', 'lobby', 'allDistricts', 'allMentors', 'greeted', 'facts10', 'facts40', 'photo', 'graduate'];

export class Achievements {
  constructor(game) {
    this.game = game;
    const d = game.save.data;
    if (!d.achievements) d.achievements = [];
    if (!d.visited) d.visited = [];
    if (!d.talked) d.talked = [];
    this.nightTime = 0; this.greets = 0;
  }
  has(id) { return this.game.save.data.achievements.includes(id); }
  unlock(id) {
    if (this.has(id)) return;
    const g = this.game;
    g.save.data.achievements.push(id); g.save.write();
    g.audio.play('success');
    g.hud.toast(`🏆 ${g.t('achievements.unlocked')}: ${g.t(`achievements.list.${id}.title`)}`, 'good');
  }
  note(kind, value) {
    const d = this.game.save.data;
    if (kind === 'district' && !d.visited.includes(value)) { d.visited.push(value); this.game.save.write(); if (d.visited.length >= 5) this.unlock('allDistricts'); }
    if (kind === 'talk' && !d.talked.includes(value)) { d.talked.push(value); this.game.save.write(); if (d.talked.length >= 6) this.unlock('allMentors'); }
    if (kind === 'greet' && ++this.greets >= 5) this.unlock('greeted');
  }
  update(dt) {
    const g = this.game, d = g.save.data;
    if (g.mode === 'car') {
      this.unlock('firstRide');
      if (Math.abs(g.car.speed) * 3.6 >= 100) this.unlock('speed100');
      this.nightTime = g.clock.night > 0.8 ? this.nightTime + dt : 0;
      if (this.nightTime > 30) this.unlock('nightDrive');
    }
    if (g.weather.state === 'storm' && g.weather.p.storm > 0.6) this.unlock('storm');
    if (d.facts.length >= 10) this.unlock('facts10');
    if (d.facts.length >= 40) this.unlock('facts40');
    if (d.graduated) this.unlock('graduate');
  }
}
