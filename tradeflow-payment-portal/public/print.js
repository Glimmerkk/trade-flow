'use strict';
const printButton=document.querySelector('#print-page');
if(printButton)printButton.addEventListener('click',()=>window.print());
