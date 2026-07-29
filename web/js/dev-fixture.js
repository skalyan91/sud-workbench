//@module js/dev-fixture.js
/* BROWSER DESIGN-MODE FIXTURE — NOT SHIPPED.
   With no pywebview bridge (web/index.html opened straight in a browser) bootBridge() returns early
   and never loads a document, so the page would render empty and none of the SVG renderers could be
   worked on. This file seeds DOC with a few sentences chosen to exercise the awkward cases: a plain
   clause, a relative clause, a French multi-word token, an Arabic RTL sentence, and a long one that
   forces the wrapped views.
   It is NOT sample data the product ships: packaging/make_*.sh delete this file from the bundle AND
   strip its <script> tag from the bundled index.html, so the shipped app carries none of it. There it
   would be inert anyway — bootBridge() replaces DOC at launch with the opened file, or with nothing.
   Loaded AFTER diagram-core.js (which declares DOC and tok) and bridge.js (hasBridge), and BEFORE
   init.js, which does the first render. */
if(typeof DOC!=="undefined" && !DOC.length && typeof hasBridge==="function" && !hasBridge()){
  const M=(t,misc)=>(t.misc=misc,t);   // tok() takes no MISC argument (it is the diagram's own constructor, and MISC is layered annotation rather than a column the renderers read positionally) — set it here rather than widening that signature for the fixture's sake
  DOC.push(
    {sid:"s1",text:"The conventions can vary.",tokens:[
      tok("The","the","DET","DT","Definite=Def|PronType=Art",2,"det"),
      tok("conventions","convention","NOUN","NNS","Number=Plur",3,"subj"),
      tok("can","can","AUX","MD","VerbForm=Fin",0,"root"),
      tok("vary","vary","VERB","VB","VerbForm=Inf",3,"comp:aux"),
      tok(".",".","PUNCT",".","",3,"punct")]},
    {sid:"s2",text:"I saw a man yesterday who was tall",tokens:[
      tok("I","I","PRON","PRP","Case=Nom|Number=Sing|Person=1",2,"subj"),
      tok("saw","see","VERB","VBD","Tense=Past",0,"root"),
      tok("a","a","DET","DT","Definite=Ind|PronType=Art",4,"det"),
      tok("man","man","NOUN","NN","Number=Sing",2,"comp:obj"),
      tok("yesterday","yesterday","ADV","RB","",2,"mod"),
      M(tok("who","who","PRON","WP","PronType=Rel",7,"subj"),"NewPar=Yes"),   // item 2: a paragraph that starts in the MIDDLE of a sentence — the case `# newpar` can't express, drawn as a pilcrow before the token

      tok("was","be","AUX","VBD","Tense=Past",4,"mod@relcl"),
      tok("tall","tall","ADJ","JJ","Degree=Pos",7,"comp:pred")]},
    // French — a multi-word token: "du" = de + le (range 3-4 in CoNLL-U)
    {sid:"s3",newpar:true,text:"Il parle du chat.",mwt:[{from:3,to:4,form:"du"}],tokens:[
      tok("Il","il","PRON","","Person=3",2,"subj"),
      tok("parle","parler","VERB","","VerbForm=Fin",0,"root"),
      tok("de","de","ADP","","",2,"mod"),
      tok("le","le","DET","","Definite=Def",5,"det"),
      tok("chat","chat","NOUN","","Gender=Masc|Number=Sing",3,"comp:obj"),
      tok(".",".","PUNCT","","",2,"punct")]},   // the `# text` ends in a full stop, so a token has to account for it: without one the units no longer reconstruct the line, the alignment rightly refuses the whole sentence, and every decoration + the running-sentence write-back go with it (samples/french_mwt.conllu has always had this token; the fixture had lost it)
    // Arabic — right-to-left, non-Latin script, with a multi-word token: "للمدرسة" = لـ + المدرسة (range 3-4)
    {sid:"s4",text:"ذهب الولد للمدرسة",rtl:true,mwt:[{from:3,to:4,form:"للمدرسة",translit:"lil-madrasa"}],tokens:[
      tok("ذهب","ذهب","VERB","","",0,"root","ḏahaba","ḏahaba"),
      tok("الولد","ولد","NOUN","","Definite=Def",1,"subj","al-walad","walad"),
      tok("لـ","ل","ADP","","",1,"mod","li","li"),
      tok("المدرسة","مدرسة","NOUN","","Definite=Def",3,"comp:obj","al-madrasa","madrasa")]},
    // goeswith — ONE word that a stray space split in the source, which is the reverse of the multi-word token in
    // s3/s4 above (one orthographic token holding several syntactic words). Both of UD's own examples are here:
    // a TWO-part word ("with out" = without, tokens 3-4) and a THREE-part one ("none the less" = nonetheless,
    // tokens 6-8), because a unit longer than two is where a chain reading and the guideline's real "every later
    // part attaches to the FIRST part" shape come apart. Annotated as the guidelines specify — the head carries the
    // POS the whole word would have had plus Typo=Yes, every continuation is X with no features and no lemma —
    // so the renderers get the case they will actually meet. The final "." sits immediately after the last part of
    // the three-part word, which is the merged-punctuation interaction (show.mergePunct folds it onto the whole
    // word as a trailing satellite, not onto its last part).
    {sid:"s6",newdoc:"dev-doc-2",newpar:true,text:"He went with out us none the less.",tokens:[
      tok("He","he","PRON","PRP","Case=Nom|Number=Sing|Person=3",2,"subj"),
      tok("went","go","VERB","VBD","Tense=Past",0,"root"),
      tok("with","without","ADP","IN","Typo=Yes",2,"mod"),
      tok("out","","X","","",3,"goeswith"),
      tok("us","we","PRON","PRP","Case=Acc|Number=Plur|Person=1",3,"comp:obj"),
      tok("none","nonetheless","ADV","RB","Typo=Yes",2,"mod"),
      tok("the","","X","","",6,"goeswith"),
      tok("less","","X","","",6,"goeswith"),
      tok(".",".","PUNCT",".","",2,"punct")]},
    // ── the three RUNNING-SENTENCE decorations (paintStext, js/core/document.js) ────────────────
    // s7 carries all three over one contiguous report; s8 exists for the case that is easy to get
    // wrong — a report whose subtree is DISCONTIGUOUS. `# text` spells the typo the way UD requires
    // (the raw sentence, with Typo=Yes/CorrectForm carrying the correction), so the deterministic
    // reconstruction settles both without any bridge call.
    {sid:"s7",text:"He said that the anser was obvious, ipso facto.",tokens:[
      tok("He","he","PRON","PRP","Case=Nom|Number=Sing|Person=3",2,"subj"),
      tok("said","say","VERB","VBD","Tense=Past",0,"root"),
      M(tok("that","that","SCONJ","IN","",2,"comp:obj"),"Reported=Yes"),        // the report is the WHOLE complement clause: tokens 3–7, one contiguous run
      tok("the","the","DET","DT","Definite=Def",5,"det"),
      M(tok("anser","answer","NOUN","NN","Number=Sing|Typo=Yes",6,"subj"),"CorrectForm=answer"),
      tok("was","be","AUX","VBD","Tense=Past",3,"comp"),
      M(tok("obvious","obvious","ADJ","JJ","Degree=Pos",6,"comp:pred"),"SpaceAfter=No"),
      tok(",",",","PUNCT",",","",10,"punct"),
      tok("ipso","ipso","ADV","FW","Foreign=Yes",10,"mod"),
      M(tok("facto","facto","NOUN","FW","Foreign=Yes",2,"mod"),"SpaceAfter=No"),
      tok(".",".","PUNCT",".","",2,"punct")]},
    // s8 — "apparently" modifies SAID, not the reported clause, yet sits inside it: the report's
    // subtree is {the, news, was, fake} and the sentence between them is not, so the running line
    // must draw TWO bands, not one sweeping band that swallows the interrupter (the same
    // membership-vs-hull distinction subtreeMembers is written around).
    {sid:"s8",text:"He said the news was, apparently, fake.",tokens:[
      tok("He","he","PRON","PRP","Case=Nom|Number=Sing|Person=3",2,"subj"),
      tok("said","say","VERB","VBD","Tense=Past",0,"root"),
      tok("the","the","DET","DT","Definite=Def",4,"det"),
      tok("news","news","NOUN","NN","Number=Sing",5,"subj"),
      M(tok("was","be","AUX","VBD","Tense=Past",2,"comp:obj"),"Reported=Yes|SpaceAfter=No"),
      tok(",",",","PUNCT",",","",7,"punct"),
      M(tok("apparently","apparently","ADV","RB","",2,"mod"),"SpaceAfter=No"),   // attaches to SAID → outside the report, though it sits in the middle of it
      tok(",",",","PUNCT",",","",7,"punct"),
      M(tok("fake","fake","ADJ","JJ","Degree=Pos",5,"comp:pred"),"SpaceAfter=No"),
      tok(".",".","PUNCT",".","",2,"punct")]},
    // a long sentence — always wide enough to trigger line-wrapping in arc view
    {sid:"s5",text:"The committee that had been formally appointed by the board last year submitted its final report to all the members yesterday afternoon.",tokens:[
      tok("The","the","DET","DT","Definite=Def",2,"det"),
      tok("committee","committee","NOUN","NN","Number=Sing",13,"subj"),
      tok("that","that","PRON","WDT","PronType=Rel",7,"subj"),
      tok("had","have","AUX","VBD","Tense=Past",7,"comp:aux"),
      tok("been","be","AUX","VBN","Tense=Past",7,"comp:aux"),
      tok("formally","formally","ADV","RB","",7,"mod"),
      tok("appointed","appoint","VERB","VBN","Tense=Past",2,"mod@relcl"),
      tok("by","by","ADP","IN","",7,"mod"),
      tok("the","the","DET","DT","Definite=Def",10,"det"),
      tok("board","board","NOUN","NN","Number=Sing",8,"comp:obj"),
      tok("last","last","ADJ","JJ","",12,"mod"),
      tok("year","year","NOUN","NN","Number=Sing",7,"mod"),
      tok("submitted","submit","VERB","VBD","Tense=Past",0,"root"),
      tok("its","its","PRON","PRP$","Poss=Yes",16,"det"),
      tok("final","final","ADJ","JJ","",16,"mod"),
      tok("report","report","NOUN","NN","Number=Sing",13,"comp:obj"),
      tok("to","to","ADP","IN","",13,"mod"),
      tok("all","all","DET","DT","",20,"det"),
      tok("the","the","DET","DT","Definite=Def",20,"det"),
      tok("members","member","NOUN","NNS","Number=Plur",17,"comp:obj"),
      tok("yesterday","yesterday","ADV","RB","",13,"mod"),
      tok("afternoon","afternoon","NOUN","NN","Number=Sing",21,"mod"),
      tok(".",".","PUNCT",".","",13,"punct")]}
  );
}
