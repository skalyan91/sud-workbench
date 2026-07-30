//@module js/ui/toast.js
/* Moved out of macos-kit/ when the Fluent kit arrived: the BEHAVIOUR (a transient chip, 1.9 s) is
   the same on both platforms and only the `.toast` styling is per-kit, so a Windows build has no
   business loading a file out of macos-kit/. Each kit styles `.toast`; this stays app-resident. */
let tt; function toast(m){const t=document.getElementById("toast"); t.textContent=m; t.classList.add("show"); clearTimeout(tt); tt=setTimeout(()=>t.classList.remove("show"),1900);}
