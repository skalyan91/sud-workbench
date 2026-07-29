"""Automatic language identification for a document's text.

Uses Meta AI's fastText ``lid.176`` language-identification model (quantised
``.ftz`` build, 176 languages).  The model file is VENDORED at
``app/data/lid.176.ftz`` so detection works fully offline — nothing is
downloaded at runtime.

Model source : https://fasttext.cc/docs/en/language-identification.html
Download URL : https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.ftz
Reference    : Joulin et al., "Bag of Tricks for Efficient Text Classification"
               and "FastText.zip: Compressing text classification models".
License      : Creative Commons Attribution-Share-Alike 3.0 (CC-BY-SA 3.0).

fastText emits labels like ``__label__en``.  Its label inventory already follows
the same convention the frontend's ``DOCLANG`` uses — ISO 639-1 (2-letter) where
one exists, otherwise ISO 639-3 (3-letter) — so mapping to the app's canonical
code is essentially identity, with a tiny alias table for the few labels whose
code diverges from the ISO norm.

Public API:
    detect_language(text: str) -> dict | None
        e.g. {"lang": "en", "conf": 0.98, "name": "English"} or None when the
        text is too short, the model is missing, or confidence is below
        threshold.  Never raises — any failure returns None.
"""

from __future__ import annotations

import os
import threading
import unicodedata

from .paths import APP_DATA  # noqa: F401  (kept for parity; model path is package-relative)

# ── configuration ────────────────────────────────────────────────────────────
_MODEL_PATH = os.path.join(os.path.dirname(__file__), "data", "lid.176.ftz")
_MIN_CHARS = 6        # too little text → don't guess (CJK is dense — a few chars is a real sentence)
_MIN_CONF = 0.50      # ignore predictions below this probability (garbage text)

# fastText labels whose code diverges from the ISO 639-1/-3 convention DOCLANG
# uses.  Everything not listed here is passed through unchanged.
_CODE_ALIASES = {
    "als": "gsw",   # fastText "als" is Alemannic German (ISO 639-3 gsw), not Tosk Albanian
}

_model = None
_load_failed = False
_lock = threading.Lock()


def _load_model():
    """Lazily load and cache the vendored fastText model.  Returns None on failure."""
    global _model, _load_failed
    if _model is not None:
        return _model
    if _load_failed:
        return None
    with _lock:
        if _model is not None:
            return _model
        if _load_failed:
            return None
        try:
            if not os.path.exists(_MODEL_PATH):
                _load_failed = True
                return None
            import fasttext  # local import: keep app startup independent of the dep
            # fastText prints a harmless deprecation notice to stderr on load; silence it.
            try:
                fasttext.FastText.eprint = lambda *a, **k: None  # type: ignore[attr-defined]
            except Exception:  # noqa: BLE001
                pass
            _model = fasttext.load_model(_MODEL_PATH)
            return _model
        except Exception:  # noqa: BLE001 — any load failure → detection disabled, never raises
            _load_failed = True
            return None


def _canonical(label: str) -> str:
    """``__label__en`` → ``en`` (app-canonical code)."""
    code = label[9:] if label.startswith("__label__") else label
    code = code.strip().lower()
    return _CODE_ALIASES.get(code, code)


def _language_name(code: str) -> str:
    """Human-readable language name for a code (best-effort; falls back to the code)."""
    try:
        import langcodes
        name = langcodes.Language.get(code).display_name()
        if name and name.lower() != code.lower():
            return name
    except Exception:  # noqa: BLE001
        pass
    return code


# ── romanised Sanskrit (IAST) override ───────────────────────────────────────
# fastText has no romanised-Sanskrit class: IAST text comes back as a generic
# Latin-script language (la/en/it/…).  We detect the IAST transliteration by its
# diacritic signature and override to Sanskrit AFTER fastText runs.
#
# The discriminating marks — the ones that essentially never occur together in
# ordinary accented Latin (French, Vietnamese, Pinyin, Spanish) — are:
#   · a COMBINING DOT BELOW (U+0323) on a CONSONANT → ṛ ṝ ḷ ḹ ṭ ḍ ṇ ṣ ḥ ṃ
#     (Vietnamese uses the dot-below only on VOWELS — ạ ẹ ị ọ ụ — so requiring a
#      consonant base excludes it; French/Pinyin have no dot-below at all)
#   · a COMBINING DOT ABOVE (U+0307) on n or m → ṅ ṁ  (guttural nasal / anusvāra)
# These form the STRONG set.  Macron long vowels (ā ī ū) are shared with Pinyin
# and ñ/ś with Spanish/Polish, so they count only as WEAK corroboration — never
# enough on their own.  We require ≥2 DISTINCT strong letters, which the
# underdot-heavy nature of Sanskrit transliteration reliably supplies while
# accented French / Pinyin / Spanish supply zero.
_IAST_DOT_BELOW = "̣"    # combining dot below  → underdot letters
_IAST_DOT_ABOVE = "̇"    # combining dot above  → ṅ ṁ
_IAST_MACRON = "̄"       # combining macron     → ā ī ū (weak; shared with Pinyin)
_IAST_TILDE = "̃"        # combining tilde      → ñ (weak; shared with Spanish)
_IAST_ACUTE = "́"        # combining acute      → ś (weak)
# consonants that take the underdot in IAST (dot-below on these = Indic, not Vietnamese)
_IAST_UNDERDOT_CONSONANTS = set("rltdnshm")
_IAST_STRONG_MIN = 2          # ≥2 DISTINCT strong letters → confident Sanskrit


def _is_latin_script(text: str) -> bool:
    """True when the alphabetic content is predominantly Latin script."""
    latin = other = 0
    for ch in text:
        if not ch.isalpha():
            continue
        try:
            name = unicodedata.name(ch)
        except ValueError:
            other += 1
            continue
        if name.startswith("LATIN"):
            latin += 1
        else:
            other += 1
    return latin > 0 and latin >= other


def _iast_signature(text: str) -> bool:
    """True when ``text`` carries a clear IAST (romanised Sanskrit) signature.

    Works on the NFD (decomposed) form so precomposed (ṣ) and combining
    (s + U+0323) inputs are treated identically.  Counts DISTINCT *strong*
    letters — a dot-below on a consonant, or a dot-above on n/m — and fires
    only at ``_IAST_STRONG_MIN`` distinct such letters, which ordinary accented
    Latin never reaches.
    """
    d = unicodedata.normalize("NFD", text)
    strong: set[str] = set()
    prev = ""
    for ch in d:
        if ch == _IAST_DOT_BELOW and prev.lower() in _IAST_UNDERDOT_CONSONANTS:
            strong.add(prev.lower() + _IAST_DOT_BELOW)          # e.g. "s̥" → ṣ, "h̥" → ḥ
        elif ch == _IAST_DOT_ABOVE and prev.lower() in ("n", "m"):
            strong.add(prev.lower() + _IAST_DOT_ABOVE)          # ṅ ṁ
        if not unicodedata.combining(ch):
            prev = ch
    return len(strong) >= _IAST_STRONG_MIN


def _predict_top(mdl, text: str):
    """Return (code, confidence) for the top prediction, bypassing fastText's
    numpy conversion (broken under numpy 2.x: ``np.array(..., copy=False)``)."""
    line = text.replace("\n", " ").replace("\r", " ")
    # fastText's Python wrapper appends "\n"; call the C++ predictor directly so
    # we never hit the numpy array coercion in FastText.predict().
    preds = mdl.f.predict(line + "\n", 1, 0.0, "strict")
    if not preds:
        return None, 0.0
    prob, label = preds[0]
    return _canonical(label), float(prob)


def detect_language(text: str) -> dict | None:
    """Detect the dominant language of ``text``.

    Returns ``{"lang": <code>, "conf": <float>, "name": <str>}`` or ``None`` when
    the text is too short, the model is unavailable, or confidence is below the
    threshold.  Never raises.
    """
    try:
        if not text or not text.strip():
            return None
        sample = text.strip()
        if len(sample) < _MIN_CHARS:
            return None
        mdl = _load_model()
        if mdl is None:
            return None
        code, conf = _predict_top(mdl, sample)
        # Romanised Sanskrit: fastText labels IAST as a generic Latin language.
        # If the sample is Latin-script and carries a clear IAST signature,
        # override to Sanskrit with high confidence (runs even when fastText's
        # own confidence was below threshold).
        if _is_latin_script(sample) and _iast_signature(sample):
            return {"lang": "sa", "conf": 0.99, "name": "Sanskrit"}
        if not code or conf < _MIN_CONF:
            return None
        return {"lang": code, "conf": round(conf, 4), "name": _language_name(code)}
    except Exception:  # noqa: BLE001 — best-effort; a failure disables detection, never breaks open
        return None
