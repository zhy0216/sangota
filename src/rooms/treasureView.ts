import { C } from '../config';
import type { RoomController, RoomHost } from '../scenes/RoomScene';
import { bodyStyle, brushStyle } from '../ui/theme';
import { openTreasure } from './treasure';

/**
 * 宝藏 — the smallest controller there is, and the one the shell is proved
 * against: enter, one button, one payout, leave.
 *
 * Note what is *not* here. No `addGold`, no `commit.once`, no read of the loot
 * table — the room module owns all three and hands back a report. This file
 * only knows how to draw one.
 */
export class TreasureController implements RoomController {
  private host!: RoomHost;

  enter(host: RoomHost): void {
    this.host = host;
    host.setTitle('宝藏', '前朝遗宝，无主之物。');
    host.setEscPolicy('leave');

    if (host.commit.isDone('open')) {
      // Walked back in after opening it — say so rather than offering it again.
      host.showResult(['箱中空空，已被取尽。'], '离 去');
      return;
    }

    this.drawChest();
    host.showOptions([{ id: 'open', label: '启 封', hint: '取走箱中之物', tone: 'gold' }], () =>
      this.open(),
    );
  }

  private drawChest(): void {
    const { area } = this.host;
    const layer = this.host.layer();
    layer.add(
      this.host.scene.add
        .text(area.x + area.w / 2, area.y + 70, '〔 尘封的木匣 〕', brushStyle(30, C.goldBright))
        .setOrigin(0.5)
        .setLetterSpacing(6),
    );
    layer.add(
      this.host.scene.add
        .text(area.x + area.w / 2, area.y + 122, '铜锁已朽，一推即开。', bodyStyle(16, C.paperDim))
        .setOrigin(0.5)
        .setLetterSpacing(2),
    );
  }

  private open(): void {
    const report = openTreasure(this.host.run, this.host.node.id);
    // null means someone got here first — a double click, or a stale button.
    if (!report) return;

    const lines = [`启封得资财 ${report.gold}。`];
    if (report.relicId) lines.push('箱底另有一物。');
    if (report.potionRefused) lines.push('丹药囊已满，只得作罢。');

    this.host.floatText(640, 380, `+${report.gold}`, 'gold');
    this.host.refreshHud();
    this.host.showResult(lines, '收 兵');
  }
}
