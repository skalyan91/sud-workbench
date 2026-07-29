//@module macos-kit/toast.js
let tt; function toast(m){const t=document.getElementById("toast"); t.textContent=m; t.classList.add("show"); clearTimeout(tt); tt=setTimeout(()=>t.classList.remove("show"),1900);}
