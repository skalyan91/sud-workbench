//@module js/colours.js
/* ===== item 9: accent-derived relation hues (arh_* — distinctive prefix, self-contained) =====
   Rotate the subj/comp/mod relation hues to follow the macOS system accent colour, preserving each
   default colour's OKLCH LIGHTNESS and CHROMA (only the hue turns). Applied ONLY while the user has
   not customised those relation colours (the item-17 Colours drawer → PREFS.relColours); if they
   have, we hand control straight back to that override. Hue relations (verified against the current
   defaults): subj = A+180°, comp = A+132° (the default comp−accent offset), mod = circular-midpoint
   of (comp+180°, subj+90°) ≡ A+291°. At the default accent #007aff (OKLCH hue ≈257°) these reproduce
   the current default hexes. sRGB↔OKLab↔OKLCH via the standard Ottosson matrices. */
function arh_srgbLin(c){ c/=255; return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4); }
function arh_linSrgb(c){ c=c<=0.0031308?12.92*c:1.055*Math.pow(c,1/2.4)-0.055; return Math.max(0,Math.min(255,Math.round(c*255))); }
function arh_hexToOklch(hex){ const n=parseInt(hex.slice(1),16);
  const r=arh_srgbLin((n>>16)&255), g=arh_srgbLin((n>>8)&255), b=arh_srgbLin(n&255);
  const l=Math.cbrt(0.4122214708*r+0.5363325363*g+0.0514459929*b);
  const m=Math.cbrt(0.2119034982*r+0.6806995451*g+0.1073969566*b);
  const s=Math.cbrt(0.0883024619*r+0.2817188376*g+0.6299787005*b);
  const L=0.2104542553*l+0.7936177850*m-0.0040720468*s;
  const A=1.9779984951*l-2.4285922050*m+0.4505937099*s;
  const B=0.0259040371*l+0.7827717662*m-0.8086757660*s;
  const C=Math.hypot(A,B); let H=Math.atan2(B,A)*180/Math.PI; if(H<0)H+=360;
  return {L,C,H}; }
function arh_oklchToHex(L,C,H){ const hr=H*Math.PI/180, a=C*Math.cos(hr), b=C*Math.sin(hr);
  const l_=L+0.3963377774*a+0.2158037573*b, m_=L-0.1055613458*a-0.0638541728*b, s_=L-0.0894841775*a-1.2914855480*b;
  const l=l_*l_*l_, m=m_*m_*m_, s=s_*s_*s_;
  const r=arh_linSrgb(+4.0767416621*l-3.3077115913*m+0.2309699292*s);
  const g=arh_linSrgb(-1.2684380046*l+2.6097574011*m-0.3413193965*s);
  const bb=arh_linSrgb(-0.0041960863*l-0.7034186147*m+1.7076147010*s);
  const hx=v=>v.toString(16).padStart(2,"0");
  return "#"+hx(r)+hx(g)+hx(bb); }
function arh_wrapDeg(d){ d%=360; if(d>180)d-=360; if(d<-180)d+=360; return d; }   // → signed angle in (−180,180]
function arh_midDeg(x,y){ return ((x+arh_wrapDeg(y-x)/2)%360+360)%360; }           // short-arc circular midpoint
function arh_huesFor(A){ const subj=((A+180)%360+360)%360, comp=((A+132)%360+360)%360;
  return {subj,comp,mod:arh_midDeg(comp+180,subj+90)}; }   // comp+180 & subj+90 are always 42° apart → short arc == A+291°, continuous
// Resolve the LIVE system accent to an [r,g,b] via a hidden probe. --accent-blue resolves to the
// AccentColor keyword (or its rgb(0,122,255) fallback on engines without AccentColor support).
let arh_probe=null;
function arh_accentRGB(){ if(!arh_probe){ arh_probe=document.createElement("span"); arh_probe.id="arhAccentProbe";
    arh_probe.style.cssText="position:absolute;left:-9999px;top:-9999px;width:0;height:0;opacity:0;pointer-events:none;color:var(--accent-blue)";
    (document.body||document.documentElement).appendChild(arh_probe); }
  const m=(getComputedStyle(arh_probe).color||"").match(/(\d+(?:\.\d+)?)/g);
  if(!m||m.length<3)return null; return [Math.round(+m[0]),Math.round(+m[1]),Math.round(+m[2])]; }
// Gate: has the user customised any of the three derived relation colours (either theme)? If so we do
// NOT auto-derive — the item-17 override <style> owns those colours. (other/root are never derived.)
function arh_hasOverride(){ const o=(typeof PREFS!=="undefined")&&PREFS.relColours; if(!o||typeof o!=="object")return false;
  for(const mode of ["light","dark"]){ const mm=o[mode]; if(mm) for(const c of ["subj","comp","mod"]) if(relColHexOK(mm[c])) return true; }
  return false; }
let arh_last={applied:"",gated:null};
// item 14: STICKY accent override. WKWebView never re-resolves the AccentColor keyword live, so once the
// native NSSystemColorsDidChangeNotification hook has pushed us the fresh system accent RGB, we must keep
// using THAT rgb for every later re-derive (poll / focus / visibility / theme flip). Otherwise the next
// pollless call falls back to arh_accentRGB()'s stale probe and snaps the hues back to the old accent.
let ARH_ACCENT_OVERRIDE=null;
// item 14 (accent family): WKWebView never re-resolves the AccentColor keyword live, so on a system-accent
// change we must repaint EVERY accent-derived UI colour ourselves, not just the deprel hues. The single CSS
// source is --accent-blue (=AccentColor). --accent and its family (focus ring, row/field/block selection)
// are baked to literal Apple-blue values, so we overwrite each on :root from the fresh rgb; the color-mix
// consumers (--accent-dim / --row-sel-dim) and the direct var(--accent-blue) reads then recompute for free.
// Called ONLY when a sticky override is active — at rest these inline props are absent and the CSS keyword/hex
// owns the accent (so the steady state still tracks the real AccentColor and the dark-mode #0a84ff stays put).
function arh_applyAccentVars(root,rgb){
  if(typeof clearCssVarCache==="function") clearCssVarCache();   // the --accent family is about to change → drop diagram-core's cached reads of it
  const dark=matchMedia("(prefers-color-scheme: dark)").matches, [r,g,b]=rgb, c=`rgb(${r},${g},${b})`;
  const wk=dark?.22:.14, rs=dark?.20:.12, ff=dark?.22:.10, bs=dark?.09:.05;   // per-theme alphas mirror the light/dark :root definitions
  root.style.setProperty("--accent-blue",c);   // active-pill highlight (#btnOptions.active) + the arh probe
  root.style.setProperty("--accent",c);         // primary accent: outlines, carets, checkbox tint, focus outlines; feeds --accent-dim/--row-sel-dim via color-mix
  root.style.setProperty("--accent-weak",`rgba(${r},${g},${b},${wk})`);   // focus-ring glow
  root.style.setProperty("--row-sel",`rgba(${r},${g},${b},${rs})`);       // grid/list row selection fill
  root.style.setProperty("--field-focus",`rgba(${r},${g},${b},${ff})`);   // text-field focus fill
  root.style.setProperty("--block-sel",`rgba(${r},${g},${b},${bs})`);     // block selection wash
}
// Pure: the accent-derived subj/comp/mod hex triad for a given accent rgb/theme, no side effects — shared by
// deriveRelHuesFromAccent (which applies it to :root) and relColLight/relColDark (which read it so the drawer
// swatches show the SAME live colours the document is actually painted with).
// A colour-blindness setting used to feed a further whole-triad hue rotation here (cbFindShift, searched against
// simulated dichromatic vision). It was removed with its drawer controls: the default relation palette is already
// close to optimal for colour-blind viewers, so the control was not earning its place. This function is what it
// was with the setting at "None" — cbFindShift returned 0 there, so the removal is exact, not a third behaviour.
function arh_relTriad(rgb,dark){
  const A=arh_hexToOklch("#"+rgb.map(v=>v.toString(16).padStart(2,"0")).join("")).H;
  const hues=arh_huesFor(A), defs=dark?RELCOL_DEFAULTS.dark:RELCOL_DEFAULTS.light;
  const out={}; ["subj","comp","mod"].forEach(c=>{ const d=arh_hexToOklch(defs[c]); out[c]=arh_oklchToHex(d.L,d.C,hues[c]); });
  return out;
}
// The triad currently in effect for a theme, or null when accent-derivation is gated off (arh_hasOverride) or
// no accent rgb is available yet — callers fall back to RELCOL_DEFAULTS/the user override in that case.
function arh_effectiveTriad(dark){
  if(arh_hasOverride())return null;
  const rgb=ARH_ACCENT_OVERRIDE||arh_accentRGB(); if(!rgb)return null;
  return arh_relTriad(rgb,dark);
}
function deriveRelHuesFromAccent(force,rgbOverride){
  const root=document.documentElement;
  const accentOv=rgbOverride||ARH_ACCENT_OVERRIDE;         // item 14: sticky system-accent override (null at rest → CSS owns the accent vars). Applied BEFORE the deprel gate so the accent family still updates even when the user has customised the deprel hues.
  if(accentOv)arh_applyAccentVars(root,accentOv);
  if(arh_hasOverride()){                                   // user customised → clear our inline hues, hand back to the override <style>
    if(arh_last.gated!==true||force){ ["subj","comp","mod"].forEach(c=>root.style.removeProperty("--c-"+c));
      arh_last={applied:"",gated:true}; if(typeof applyRelColours==="function")applyRelColours();   // udep + drawer swatches must fall back off the accent triad too
      if(typeof DOC!=="undefined"&&DOC.length)preserveScroll(renderDoc); }
    return; }
  const rgb=rgbOverride||ARH_ACCENT_OVERRIDE||arh_accentRGB(); if(!rgb)return;   // item 9/14: prefer the fresh RGB the native accent-change hook pushed (kept sticky in ARH_ACCENT_OVERRIDE) over the stale AccentColor keyword the probe reads — WKWebView doesn't refresh that keyword live, so a later pollless call would otherwise snap the hues back
  const dark=matchMedia("(prefers-color-scheme: dark)").matches;
  const key=rgb.join(",")+"|"+(dark?"d":"l");   // the derivation's whole input, so this is a complete cache key (a colour-blindness type/intensity used to be a third and fourth field — removed with the setting)
  if(!force&&arh_last.gated===false&&arh_last.applied===key)return;   // accent + theme unchanged → nothing to do
  const triad=arh_relTriad(rgb,dark);
  ["subj","comp","mod"].forEach(c=>root.style.setProperty("--c-"+c,triad[c]));
  arh_last={applied:key,gated:false};
  if(typeof applyRelColours==="function")applyRelColours();   // repaint --c-udep (comp/mod midpoint) + refresh the drawer swatches from the new triad
  if(typeof DOC!=="undefined"&&DOC.length)preserveScroll(renderDoc);   // relColor()/css() BAKE --c-* at render time → must re-render for the diagram to pick up new hues
}
// The boot call + 1s poll moved to js/init.js (they render → renderDoc's grid path needs miscTranslit,
// declared in the later-loaded js/translit-load.js, so they can't run at this module's load time).
addEventListener("focus",()=>deriveRelHuesFromAccent(false));
document.addEventListener("visibilitychange",()=>{ if(!document.hidden)deriveRelHuesFromAccent(false); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change",()=>{ deriveRelHuesFromAccent(true); preserveScroll(renderDoc); });   // (c) theme flip: re-derive with the new theme's default L/C, then keep the scroll (a theme flip must never jump the scroll position)
// (d) item 9: the native side observes NSSystemColorsDidChangeNotification and pushes the fresh system accent RGB here (WKWebView won't re-resolve the AccentColor keyword on its own, so the JS poll above can't see the change).
window.__accentChanged=function(r,g,b){ ARH_ACCENT_OVERRIDE=[Math.round(+r),Math.round(+g),Math.round(+b)]; deriveRelHuesFromAccent(true,ARH_ACCENT_OVERRIDE); };   // item 14: remember the fresh accent so every later re-derive stays on it (no snap-back). deriveRelHuesFromAccent now also repaints the whole accent family (arh_applyAccentVars) from this sticky override, so both the deprel hues AND --accent/--accent-blue/selection/focus colours update live.

/* ===== item 17: Colours drawer — customise the 5 dependency-relation category colours (--c-subj/comp/mod/other/root)
   for light AND dark, persisted in PREFS.relColours={light:{…},dark:{…}}. The app themes purely via
   @media(prefers-color-scheme:dark) — no data-theme attribute — so overrides are emitted as a live <style>:
   :root{…}  for light and  @media(prefers-color-scheme:dark){:root{…}}  for dark. All names are unique. ===== */
const RELCOL_DEFAULTS={
  light:{subj:"#b88735",comp:"#cd7468",mod:"#00a79e",other:"#8991a1",root:"#a3abbb"},
  // dark = contrast-preserving derivation of light (relColDarken): each colour's contrast against the #1e1e1e
  // bg equals its light twin's contrast against white, so the rank holds (root lowest ~2.3:1, least prominent).
  dark: {subj:"#8b6628",comp:"#a35c52",mod:"#00756f",other:"#666c78",root:"#53575f"}
};
const RELCOL_CATS=[["subj","Subject"],["comp","Complement"],["mod","Modifier"],["other","Other"],["root","Root"]];
// British "Colours" by default; American "Colors"/"Color" only when the browser locale is en-US.
const US_LOCALE=/^en-US/i.test(navigator.language||"");
const COLOUR_LABEL=US_LOCALE?"Colors":"Colours";
/* A COLOUR-BLINDNESS SECTION USED TO SIT AT THE BOTTOM OF THIS DRAWER and is deliberately gone — a type popup
   (None / Protanopia / Deuteranopia / Tritanopia) + an intensity slider, backed by Machado, Oliveira & Fernandes
   (2009) dichromacy simulation matrices and a ±70° search (cbFindShift) for the whole-triad hue rotation that kept
   the simulated subj/comp/mod furthest apart. It was removed, machinery and all, because the DEFAULT relation
   palette is already close to optimal for colour-blind viewers, so the controls were not earning their place in a
   toolbar popover. Nothing about the derivation changed with them: cbFindShift returned 0 for "none", which is
   what every user who never opened the section had, so arh_relTriad below is the same function it always was for
   them — verified by capturing the computed --c-* over a ten-accent sweep in both themes before and after
   (scratchpad relhues.mjs), identical in all 120 values. An older prefs file may still carry `colourBlind` /
   `colourBlindLevel`; loadPrefs simply stops reading them, so they are ignored and then dropped by the next save. */
function relColHexOK(h){ return typeof h==="string" && /^#[0-9a-fA-F]{6}$/.test(h); }
// WCAG relative luminance of an #rrggbb colour (sRGB channel → linear-light → weighted sum).
function relColLum(hex){ const f=v=>{ v/=255; return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4); };
  const n=parseInt(hex.slice(1),16); return 0.2126*f((n>>16)&255)+0.7152*f((n>>8)&255)+0.0722*f(n&255); }
const RELCOL_DARKBG_LUM=relColLum("#1e1e1e");   // luminance of the dark-theme window bg (--win-bg)
// Derive a dark-mode colour from a light-mode colour by PRESERVING WCAG CONTRAST, not brightness.
// A light colour sits DARKER than the white light bg, with contrast Cw = 1.05/(Lc+0.05); on the #1e1e1e
// dark bg the colour instead sits LIGHTER, so we uniformly scale its sRGB channels (hue-preserving, the
// same multiply the old fixed-0.9 shade used) until its contrast AGAINST THE DARK BG equals that same Cw.
// This keeps every category's contrast RANK identical across themes: the least-contrasting light colour
// (root, ~2.3:1 on white) stays the least-contrasting on dark — closest to the bg, dimmest — instead of a
// constant multiply that left already-light root the BRIGHTEST/most-prominent in dark mode. (The `f` arg is
// retained for call-site compatibility but ignored; the scale is now solved for, not fixed.)
function relColDarken(hex,f){ if(!relColHexOK(hex))return hex;
  const n=parseInt(hex.slice(1),16), r=(n>>16)&255, g=(n>>8)&255, b=(n&255);
  const Lc=relColLum(hex); if(Lc<=0)return hex;
  const K=RELCOL_DARKBG_LUM+0.05;
  const Cw=1.05/(Lc+0.05);              // light colour's contrast against white
  const Ld=Math.max(0,Cw*K-0.05);       // target luminance whose contrast against the dark bg == Cw
  const cl=v=>Math.max(0,Math.min(255,v));
  const lumScaled=s=>{ const f2=v=>{ v=cl(v*s)/255; return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4); };
    return 0.2126*f2(r)+0.7152*f2(g)+0.0722*f2(b); };
  let s=Math.pow(Ld/Lc,1/2.4);          // first guess (L ≈ s^2.4·Lc); refine for gamma curvature + clamping
  for(let i=0;i<20;i++){ const cur=lumScaled(s); if(cur<=0)break; s*=Math.pow(Ld/cur,1/2.4); }
  const hx=v=>cl(Math.round(v*s)).toString(16).padStart(2,"0");
  return "#"+hx(r)+hx(g)+hx(b); }
// Link light/dark is ON BY DEFAULT: only an explicitly-persisted false turns it off (unset → true).
function relColLinked(){ return PREFS.relColLink!==false; }
// Effective colour for a category: explicit user override, else — for subj/comp/mod only — the LIVE
// accent-derived triad (arh_effectiveTriad, the same values deriveRelHuesFromAccent paints with), else the
// static default. This is what makes the drawer swatches track the system accent instead of always showing
// the frozen RELCOL_DEFAULTS.
function relColLight(cat){ const o=PREFS.relColours; const ov=o&&o.light&&o.light[cat]; if(relColHexOK(ov))return ov;
  if(cat==="subj"||cat==="comp"||cat==="mod"){ const t=arh_effectiveTriad(false); if(t)return t[cat]; }
  return RELCOL_DEFAULTS.light[cat]; }
// Effective dark colour: while linked it is DERIVED from the (now live) light colour (relColDarken); unlinked
// it is the override, else the live accent-derived dark triad, else the static default.
function relColDark(cat){ if(relColLinked())return relColDarken(relColLight(cat));
  const o=PREFS.relColours; const ov=o&&o.dark&&o.dark[cat]; if(relColHexOK(ov))return ov;
  if(cat==="subj"||cat==="comp"||cat==="mod"){ const t=arh_effectiveTriad(true); if(t)return t[cat]; }
  return RELCOL_DEFAULTS.dark[cat]; }
// udep is never user-customisable: it's ALWAYS the midpoint of the effective comp and mod colours in linear
// sRGB space (not hue/OKLab — a plain per-channel average after removing gamma), so it stays halfway between
// them by construction whatever comp/mod currently resolve to (accent-derived or overridden).
function relColMidLinear(hexA,hexB){ const na=parseInt(hexA.slice(1),16), nb=parseInt(hexB.slice(1),16);
  const mix=sh=>arh_linSrgb((arh_srgbLin((na>>sh)&255)+arh_srgbLin((nb>>sh)&255))/2);
  const hx=v=>v.toString(16).padStart(2,"0");
  return "#"+hx(mix(16))+hx(mix(8))+hx(mix(0)); }
// Write (or clear) the live override <style>. Does NOT re-render — callers re-render when needed.
function applyRelColours(){
  if(typeof clearCssVarCache==="function") clearCssVarCache();   // …and the --c-* relation hues, for the same reason
  const o=(PREFS.relColours&&typeof PREFS.relColours==="object")?PREFS.relColours:{};
  const cats=RELCOL_CATS.map(c=>c[0]);
  const linked=relColLinked();
  // Light: emit only the categories the user actually overrode, PLUS udep (always derived, never overridden).
  const light=cats.filter(c=>o.light&&relColHexOK(o.light[c])).map(c=>`--c-${c}:${o.light[c]}`)
    .concat(`--c-udep:${relColMidLinear(relColLight("comp"),relColLight("mod"))}`).join(";");
  // Dark: when linked, derive every category from its light colour (so a fresh linked user gets a consistent
  //       dark palette out of the box); when unlinked, emit only the categories the user overrode. Plus udep.
  const dark=(linked
    ? cats.map(c=>`--c-${c}:${relColDark(c)}`)
    : cats.filter(c=>o.dark&&relColHexOK(o.dark[c])).map(c=>`--c-${c}:${o.dark[c]}`))
    .concat(`--c-udep:${relColMidLinear(relColDark("comp"),relColDark("mod"))}`).join(";");
  // udep is always present in both `light`/`dark` now, so this <style> always has content (unlike the old
  // override-only version, which removed the element entirely when nothing was overridden).
  let el=document.getElementById("relColOverride");
  if(!el){ el=document.createElement("style"); el.id="relColOverride"; document.head.appendChild(el); }
  el.textContent=`:root{${light}}@media (prefers-color-scheme:dark){:root{${dark}}}`;
  syncColourPickers();
}
// Reflect the effective colour on every picker (dark = derived while linked); disable the dark pickers while linked.
function syncColourPickers(){
  const linked=relColLinked();
  document.querySelectorAll('#colourPop input[type="color"]').forEach(inp=>{
    const cat=inp.dataset.cat, mode=inp.dataset.mode;
    inp.value=(mode==="dark")?relColDark(cat):relColLight(cat);
  });
  document.querySelectorAll('#colourPop input[data-mode="dark"]').forEach(inp=>{ inp.disabled=linked; });
  const link=document.getElementById("colourLinkChk"); if(link)link.checked=linked;
}
function _relColSet(mode,cat,hex){ PREFS.relColours=PREFS.relColours||{}; PREFS.relColours[mode]=PREFS.relColours[mode]||{}; PREFS.relColours[mode][cat]=hex; }
function initColourDrawer(){
  const pop=document.getElementById("colourPop"); if(!pop||pop._built)return; pop._built=true;
  const lbl=document.getElementById("colourDrawerLabel"); if(lbl)lbl.textContent=COLOUR_LABEL;
  // self-contained styles (unique class names; does not touch the shared drawer/bar CSS)
  if(!document.getElementById("relColStyles")){ const st=document.createElement("style"); st.id="relColStyles";
    st.textContent=".relcol-grid{display:grid; grid-template-columns:1fr auto auto; gap:6px 12px; align-items:center}"+   /* label col = 1fr absorbs slack (the popover width is set by the wider footer), pushing the Light/Dark swatch pair to the right content edge so left/right padding stays symmetric; swatches stay centred under their caps via justify-self */
      ".relcol-grid .relcol-cap{font-size:9.5px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--muted); text-align:center}"+
      /* the section heading lives in the grid's CORNER cell, so it sits on the same row — and the same
         baseline — as the Light/Dark column caps instead of on a line of its own above them */
      ".relcol-grid .relcol-corner{text-align:left; justify-self:start; white-space:nowrap}"+
      /* A "#colourPop > .drawer-group-h{margin-top:0; padding-top:10px}" rule used to sit here, tuning the
         separator rule above the "Colour blindness" heading — the drawer's one top-level .drawer-group-h.
         That section is gone (see the note beside relColHexOK), and with it the only element the rule could
         ever match: this popover's own heading, "Relation colours", is the grid's CORNER CELL, not a
         .drawer-group-h. Dropped rather than left as dead CSS. */
      ".relcol-grid .relcol-cat{font-size:12px; color:var(--text); white-space:nowrap}"+
      '.relcol-grid input[type="color"]{justify-self:center; width:34px; height:22px; padding:0; border:.5px solid var(--hairline-strong); border-radius:5px; background:var(--field-bg); cursor:pointer}'+
      '.relcol-grid input[type="color"]:disabled{opacity:.4; cursor:not-allowed}'+
      ".relcol-foot{display:flex; align-items:center; justify-content:space-between; gap:16px}"+   /* a Form Row: the "Link light & dark" label leads, the Reset button is the Right Accessory flush to the trailing edge. 16px is the gutter the Figma Form frame (node 2302:6358) keeps between the two in every row; the row's HEIGHT stays the popover's compact 24px rather than the kit's 42 — see the .drawer-pop > label.chk note in styles/app.css for why a toolbar popover can't take the pane-scale row height */
      ".relcol-reset{font:inherit; font-size:12px; font-weight:500; color:var(--text); background:var(--field-bg); border:.5px solid var(--hairline-strong); border-radius:6px; height:24px; padding:0 10px; cursor:pointer}"+
      ".relcol-reset:hover{background:color-mix(in srgb,var(--text) 8%,var(--field-bg))}";
      /* The .relcol-cbrow (deficiency popup) and .relcol-sevrow (intensity slider) rules stood here and went
         with their controls. Worth recording why the slider row needed its own width dance, in case another
         range input is ever put in a toolbar popover: a range input carries a chunky intrinsic width (~130px
         in WebKit) and a grid track reports its item's MAX-CONTENT size while the container sizes itself, so
         that ONE row was setting the whole popover's width (231.5px against the swatch grid's 199). The fix
         was `width:0; min-width:100%` on the row — nothing during the intrinsic pass, stretched back to
         whatever the other rows settled on — plus minmax(0,1fr) + min-width:0 so the track could shrink
         below its own intrinsic width. With the row gone the popover is sized by the swatch grid and the
         footer, which is what it was always meant to be. */
    document.head.appendChild(st); }
  const grid=document.createElement("div"); grid.className="relcol-grid";
  grid.appendChild(Object.assign(document.createElement("span"),{className:"relcol-cap relcol-corner",textContent:"Relation colours"}));   // the section heading IS the corner cell — same row as the Light/Dark caps, no line of its own
  grid.appendChild(Object.assign(document.createElement("span"),{className:"relcol-cap",textContent:"Light"}));
  grid.appendChild(Object.assign(document.createElement("span"),{className:"relcol-cap",textContent:"Dark"}));
  RELCOL_CATS.forEach(([cat,label])=>{
    grid.appendChild(Object.assign(document.createElement("span"),{className:"relcol-cat",textContent:label}));
    ["light","dark"].forEach(mode=>{
      const inp=document.createElement("input"); inp.type="color"; inp.dataset.cat=cat; inp.dataset.mode=mode;
      inp.setAttribute("aria-label",label+" ("+mode+")"); inp.value=RELCOL_DEFAULTS[mode][cat];
      inp.addEventListener("input",()=>{ _relColSet(mode,cat,inp.value);   // when linked, the dark decl is derived from light inside applyRelColours (dark pickers are disabled anyway)
        applyRelColours(); if(typeof DOC!=="undefined"&&DOC.length)preserveScroll(renderDoc); savePrefs(); });
      grid.appendChild(inp);
    });
  });
  pop.appendChild(grid);
  const foot=document.createElement("div"); foot.className="relcol-foot";
  const linkLbl=document.createElement("label"); linkLbl.className="chk"; linkLbl.title="Derive each dark colour from its light colour, preserving its WCAG contrast against the background";
  const link=document.createElement("input"); link.type="checkbox"; link.id="colourLinkChk"; link.checked=relColLinked();   // ON by default (unset → linked)
  link.addEventListener("change",()=>{ PREFS.relColLink=link.checked;   // record an EXPLICIT choice; false persists as off, dark decls are derived-when-linked inside applyRelColours
    applyRelColours(); if(typeof DOC!=="undefined"&&DOC.length)preserveScroll(renderDoc); savePrefs(); });
  linkLbl.appendChild(link); linkLbl.appendChild(document.createTextNode("Link light/dark"));
  const reset=document.createElement("button"); reset.type="button"; reset.className="relcol-reset"; reset.textContent="Reset";
  reset.addEventListener("click",()=>{ delete PREFS.relColours; applyRelColours(); if(typeof DOC!=="undefined"&&DOC.length)preserveScroll(renderDoc); savePrefs(); });
  foot.appendChild(linkLbl); foot.appendChild(reset); pop.appendChild(foot);
  // The footer is the LAST thing in this popover now: a "Colour blindness" section (heading + deficiency popup
  // + intensity slider) used to follow it and was removed whole — see the note beside relColHexOK for why, and
  // for the evidence that dropping it left the accent derivation bit-for-bit unchanged.
}
initColourDrawer();
applyRelColours();   // no saved overrides yet at parse time → pickers show defaults, no override <style>

