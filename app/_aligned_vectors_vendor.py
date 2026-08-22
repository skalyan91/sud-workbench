"""VENDORED — the reader for the cross-lingually aligned vector assets.

Source: ``scripts/aligned_vectors.py`` from Sunflower AI's **SUD-spaCy**
(github.com/SunflowerAI/sud-spacy-parsers), MIT, Copyright (c) 2026 Sunflower AI, as it stands
beside the ``vectors-v0.1.0`` release (md5 of the original ``719700980e463027a2ad4cf70adb603d``).

Copied with the ``argparse`` CLI at the foot of the file dropped and nothing else changed: it
imports only ``json``/``os``/``unicodedata``/``numpy``, so there was nothing else to strip.

⚠ THIS IS THE ASSET'S OWN READER AND MUST NOT BE HAND-EDITED HERE. Three things about an asset
cannot be guessed and are carried in its ``meta`` — whether keys are lowercased (worth 31 points of
English type coverage), whether it is keyed by FORM or by LEMMA (``sa`` is the one keyed by lemma),
and whether a ``key_norm`` fold applies (``la`` is the one that has one). Re-deriving any of them on
this side is how the app comes to disagree with the file it is reading. Re-vendor the upstream file
instead; :mod:`app.vectors` is where this app's own opinions belong.

Upstream's own docstring follows.

    Read the aligned side-asset vector tables and look words up across languages.

        from scripts.aligned_vectors import AlignedVectors
        en = AlignedVectors.load("release_vectors/sud_vec_en_128d.npz")
        sa = AlignedVectors.load("release_vectors/sud_vec_sa_128d.npz")
        sa.nearest(en["water"], k=5)          # -> [('jala', 0.62), ...]

    Every asset in a release shares one basis and one mean, so vectors from different files are
    directly comparable and a cosine is a plain dot product (rows are unit length).

    TWO THINGS THE CALLER MUST NOT GUESS, both carried in the asset's own meta:

      * `lookup` -- the published aligned fastText vectors are LOWERCASED and the CC ones are not.
        Getting this wrong costs 31 points of English type coverage (53.9 % against 84.8 %).
        `__getitem__` reads the flag; do not case-fold by hand.
      * `key_attr` -- sa is keyed by LEMMA, because Apte (its only anchor source) is keyed by stems
        and because Sanskrit inflection makes a form-keyed table mostly hapax. Everything else is
        keyed by surface FORM. `key_for(token)` picks the right attribute off a spaCy Token.
"""
from __future__ import annotations
import glob, json, os, unicodedata

import numpy as np


def _norm_la(w):
    """Latin orthography folded onto ONE spelling, so that `vita`, `uita`, `vīta` and `vītæ`'s stem
    are not four unrelated keys.

    Our Latin treebanks are u-dominant -- only 2.2 % of tokens contain a `v` and none contain a `j`,
    a macron or a ligature -- while Wikisource, the Latin Library and Perseus all use `v` and `j`
    freely. Without this fold the corpus and the treebank barely share a vocabulary. The released
    la arm is orthography-augmented and will happily hand you any of the four spellings, so the fold
    has to happen at LOOKUP too; that is why it travels in the asset's meta as `key_norm` rather
    than living only in the build script.
    """
    w = unicodedata.normalize("NFD", w.lower())
    w = "".join(c for c in w if not unicodedata.combining(c))   # macrons and breves off
    return (w.replace("æ", "ae").replace("œ", "oe")
             .replace("v", "u").replace("j", "i"))


KEY_NORM = {"la": _norm_la}


class AlignedVectors:
    def __init__(self, keys, vectors, meta, basis=None, mean=None, rotation=None):
        self.keys = keys
        self.vectors = vectors
        self.meta = meta
        self.basis, self.mean, self.rotation = basis, mean, rotation
        self._index = {k: i for i, k in enumerate(keys)}
        self.lower = bool(meta.get("lowercased", False))
        self.key_norm = KEY_NORM.get(meta.get("key_norm") or "")
        self.lang = meta.get("lang", "?")
        self.key_attr = meta.get("key_attr", "form")

    @classmethod
    def load(cls, path):
        z = np.load(path, allow_pickle=False)
        meta = json.loads(str(z["meta"]))
        keys = bytes(z["keys"]).decode("utf-8").split("\n")
        return cls(keys, z["vectors"], meta, z.get("basis"), z.get("mean"), z.get("rotation"))

    def fold(self, key):
        if self.key_norm is not None:
            return self.key_norm(key)
        return key.lower() if self.lower else key

    def __contains__(self, key):
        return self.fold(key) in self._index

    def __getitem__(self, key):
        i = self._index.get(self.fold(key))
        return None if i is None else self.vectors[i]

    def key_for(self, token):
        """The string to look a spaCy Token up by, per this asset's key_attr."""
        return token.lemma_ if self.key_attr == "lemma" else token.text

    def nearest(self, vec, k=5):
        if vec is None:
            return []
        s = self.vectors @ vec
        idx = np.argpartition(-s, min(k, len(s) - 1))[:k]
        idx = idx[np.argsort(-s[idx])]
        return [(self.keys[i], float(s[i])) for i in idx]

    def project(self, raw):
        """Project a RAW source-space vector (300d, unnormalised) into the shared space -- for
        extending an asset with a word its source vocabulary was cut before reaching."""
        v = raw / (np.linalg.norm(raw) + 1e-9)
        v = (v @ self.rotation - self.mean) @ self.basis
        return (v / (np.linalg.norm(v) + 1e-9)).astype(np.float32)

    def __repr__(self):
        return (f"<AlignedVectors {self.lang} {len(self.keys)} keys x {self.vectors.shape[1]}d "
                f"key={self.key_attr}{' lower' if self.lower else ''}>")


def load_dir(d):
    out = {}
    for p in sorted(glob.glob(os.path.join(d, "sud_vec_*_*d.npz"))):
        v = AlignedVectors.load(p)
        out[v.lang] = v
    return out
