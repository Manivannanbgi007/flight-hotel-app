import { bottomBarLift } from './useAvoidBottomBars';

function rect(top: number, bottom: number, left = 0, right = 390): DOMRect {
  return { top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) };
}

describe('bottomBarLift', () => {
  const original = document.elementsFromPoint;
  let launcher: HTMLElement;
  let bar: HTMLElement;

  beforeEach(() => {
    window.innerHeight = 844;
    launcher = document.createElement('button');
    bar = document.createElement('div');
    const button = document.createElement('button');
    bar.append(button);
    document.body.append(launcher, bar);
    launcher.getBoundingClientRect = () => rect(772, 828, 318, 374);
    document.elementsFromPoint = () => [launcher, button, bar, document.body, document.documentElement];
  });

  afterEach(() => {
    document.elementsFromPoint = original;
    document.body.innerHTML = '';
  });

  it('lifts the launcher above a bar stuck to the bottom of the screen', () => {
    bar.style.position = 'fixed';
    bar.getBoundingClientRect = () => rect(764, 844);

    expect(bottomBarLift(launcher, 0)).toBe(828 - 764 + 12);
  });

  it('also above a bottom-sticky save bar, measured from the resting place', () => {
    bar.style.position = 'sticky';
    bar.style.bottom = '0px';
    bar.getBoundingClientRect = () => rect(780, 844);
    launcher.getBoundingClientRect = () => rect(772 - 60, 828 - 60, 318, 374);

    expect(bottomBarLift(launcher, 60)).toBe(828 - 780 + 12);
  });

  it('lifts the launcher above pagination (marked data-assistant-avoid) passing underneath it', () => {
    bar.setAttribute('data-assistant-avoid', '');
    bar.getBoundingClientRect = () => rect(790, 850);
    expect(bottomBarLift(launcher, 0)).toBe(828 - 790 + 12);

    // Near the top of the screen it is left alone (the launcher would have to jump too far).
    bar.getBoundingClientRect = () => rect(150, 210);
    expect(bottomBarLift(launcher, 0)).toBe(0);
  });

  it('ignores page content, top-sticky cards and full-screen overlays', () => {
    expect(bottomBarLift(launcher, 0)).toBe(0);

    bar.style.position = 'sticky';
    bar.style.top = '96px';
    bar.getBoundingClientRect = () => rect(96, 900);
    expect(bottomBarLift(launcher, 0)).toBe(0);

    bar.style.position = 'fixed';
    bar.getBoundingClientRect = () => rect(0, 844);
    expect(bottomBarLift(launcher, 0)).toBe(0);
  });
});
