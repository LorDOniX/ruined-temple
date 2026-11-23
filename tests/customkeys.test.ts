import { describe, expect, it } from 'vitest';
import { applyKeys, parseCustomKeys, type KeyedButton } from '../src/ui/customkeys';

const button = (x: number, y: number, hotkey: string, ids: string[], extra: Partial<KeyedButton> = {}): KeyedButton => ({
  x,
  y,
  hotkey,
  tooltip: () => '<div class="tt-title">Title</div>body',
  keys: { ids },
  ...extra,
});

describe('custom keys', () => {
  const keys = parseCustomKeys(`// comment
[CmdMove]
Tip=Move it
Hotkey=Q
Buttonpos=1,2

[CmdCancel]
Hotkey=512

[Rhme]
Hotkey=X,Y,Z

[Arav]
Hotkey=F
Unhotkey=L
Unbuttonpos=3,1
`);

  it('applies hotkeys, button positions, level hotkeys, off-state keys and Esc codes from CustomKeys.txt', () => {
    const move = button(0, 0, 'M', ['CmdMove']);
    const cancel = button(3, 2, 'X', ['CmdCancelBuild', 'CmdCancel']);
    const research = button(0, 0, 'W', ['R001', 'Rhme'], { keys: { ids: ['Rhme'], level: 2 } });
    const land = button(2, 2, 'A', ['A00U', 'Arav'], { keys: { ids: ['A00U', 'Arav'], un: true } });
    applyKeys([move, cancel, research, land], 'custom', keys);
    expect([move.hotkey, move.x, move.y]).toEqual(['Q', 1, 2]);
    expect(move.tooltip()).toContain('Move it');
    expect(cancel.hotkey).toBe('ESCAPE');
    expect(research.hotkey).toBe('Y');
    expect([land.hotkey, land.x, land.y]).toEqual(['L', 3, 1]);
  });

  it('grid layout keys buttons by position and keeps Esc', () => {
    const a = button(2, 1, 'M', []);
    const esc = button(3, 2, 'ESCAPE', []);
    applyKeys([a, esc], 'grid', null);
    expect(a.hotkey).toBe('D');
    expect(esc.hotkey).toBe('ESCAPE');
  });
});
