// Real game-menu keyboard and target checks for browser_check.mjs, URL ?debug=1.
// Optional: inject pinned axe before this body to scan every menu tab too. Uses only a fresh QA browser context.
const checks=[],check=(name,pass,detail)=>checks.push({name,pass:!!pass,detail});
const until=async(fn,ms=120000)=>{for(let n=0;n<ms;n+=100){if(fn())return true;await wait(100);}return false;};
document.querySelector('[data-action="skip"]')?.click();await wait(120);document.querySelector('[data-action="enter"]')?.click();await wait(1400);
check('game finishes loading',await until(()=>!$('#play').disabled),$('#boot-status').textContent);if($('#play').disabled)return {ok:false,notes:checks};
$('#play').click();await until(()=>$('#boot').hidden,5000);$('#pause-btn').click();await wait(300);
const root=$('#pause'),visible=e=>!!e.getClientRects().length&&!e.closest('[hidden],[inert]');
check('fresh camera motion follows the system',window.__isgame.game.save.data.settings.reduceMotion===matchMedia('(prefers-reduced-motion: reduce)').matches,{setting:window.__isgame.game.save.data.settings.reduceMotion,system:matchMedia('(prefers-reduced-motion: reduce)').matches});
for(const tab of root.querySelectorAll('[role="tab"]')){
 tab.click();await wait(200);check('tab '+tab.dataset.tab,tab.getAttribute('aria-selected')==='true');
 const controls=[...root.querySelectorAll('button,input,select,summary')].filter(visible).map(e=>{const target=e.matches('input[type="checkbox"]')?e.labels?.[0]||e:e;const r=target.getBoundingClientRect();return {id:e.id,label:e.getAttribute('aria-label')||e.textContent.trim().slice(0,60),width:r.width,height:r.height};});
 check('44px controls '+tab.dataset.tab,controls.every(e=>e.width>=43.5&&e.height>=43.5),controls.filter(e=>e.width<43.5||e.height<43.5));
 const list=[...root.querySelectorAll('button,a[href],input,select,summary,[tabindex]')].filter(e=>visible(e)&&!e.disabled&&e.tabIndex>=0);
 list.at(-1).focus();await key('Tab');check('Tab stays in '+tab.dataset.tab,document.activeElement===list[0],document.activeElement.id||document.activeElement.tagName);
 list[0].focus();await key('Tab',true);check('Shift Tab stays in '+tab.dataset.tab,document.activeElement===list.at(-1),document.activeElement.id||document.activeElement.tagName);
 const body=$('#menu-body');for(let y=0,i=0;y<body.scrollHeight;y+=Math.max(200,body.clientHeight-60),i++){body.scrollTop=y;await wait(150);await shot('menu-'+tab.dataset.tab+'-'+i);if(body.scrollTop+body.clientHeight>=body.scrollHeight-1)break;}
 if(typeof axe!=='undefined'){const a=await axe.run(root,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});check('axe '+tab.dataset.tab,a.violations.length===0,a.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})));}
}
$('#tab-settings').click();const slider=$('#set-sens'),old=slider.value;slider.focus();await key('ArrowRight');check('keyboard changes sensitivity',Number(slider.value)>Number(old),{before:old,after:slider.value});slider.value=old;slider.dispatchEvent(new Event('change',{bubbles:true}));
await key('Escape');check('Escape resumes city',root.hidden&&!window.__isgame?.game.paused);
const game=window.__isgame.game;
game.menu.card({title:'Prueba local <etiqueta>',paragraphs:['Ficha ficticia para comprobar teclado y escape de texto.'],actions:[{label:'Primero',keepOpen:true},{label:'Seguir jugando',primary:true}]});
const actions=[...$('#card-actions').querySelectorAll('button')];actions.at(-1).focus();await key('Tab');check('card Tab wraps',document.activeElement===actions[0],document.activeElement.id||document.activeElement.tagName);
actions[0].focus();await key('Tab',true);check('card Shift Tab wraps',document.activeElement===actions.at(-1),document.activeElement.id||document.activeElement.tagName);
check('card title is plain text',$('#card-title').textContent==='Prueba local <etiqueta>'&&!$('#card-title').querySelector('etiqueta'));
await shot('card-keyboard-fixture');await key('Escape');check('card Escape closes',!game.menu.cardOpen&&$('#card').hidden);
return {ok:checks.every(c=>c.pass),notes:checks};
