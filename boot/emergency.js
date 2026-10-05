/* Independent fallback. It needs no engine, module import, or Promise. */
(function (w,d) {
  'use strict';
  w.GameBootEmergency = function (code,error) {
    if (w.GameBoot && w.GameBoot.fail) { w.GameBoot.fail(code,error); return; }
    if (w.__gameBootEarlyFailure) return;
    var message='The startup code is missing or damaged.', stack='';
    try { message=String(error && error.message || error || message).slice(0,1600); stack=String(error && error.stack || '').slice(0,6000); } catch (_) {}
    var report={protocol:'GAMEBOOT/1',loaderVersion:'1.0.2',state:'FAIL',stage:'B00',code:code,message:message,stack:stack,browser:w.navigator.userAgent};
    try { report.game=JSON.parse(d.getElementById('gb-config').textContent); } catch (_) {}
    w.__gameBootEarlyFailure=report;
    var root=d.getElementById('gb-root');
    if (!root) { root=d.createElement('section'); root.id='gb-root'; var pre=d.createElement('pre'); pre.textContent=JSON.stringify(report,null,2); root.appendChild(pre); (d.body || d.documentElement).appendChild(root); }
    root.hidden=false; root.setAttribute('data-state','FAIL');
    function set(id,text) { var el=d.getElementById(id); if(el) el.textContent=text; }
    set('gb-state',code+' / STARTUP STOPPED'); set('gb-message',message);
    set('gb-stage','B00 / '+code); set('gb-hint','Capture this screen or copy the report. No game loop is running.');
    set('gb-browser',w.navigator.userAgent); set('gb-log',JSON.stringify(report,null,2));
    var mount=d.getElementById('game-mount'); if(mount){mount.setAttribute('inert','');mount.setAttribute('aria-hidden','true');}
    var retry=d.getElementById('gb-retry'); if(retry){retry.hidden=false;retry.onclick=function(){w.location.reload();};}
    function copy(){var area=d.getElementById('gb-report-text');if(area){area.hidden=false;area.value=JSON.stringify(report,null,2);area.focus();area.select();try{d.execCommand('copy');}catch(_){}}}
    var copyButton=d.getElementById('gb-copy');if(copyButton)copyButton.onclick=copy;
    var save=d.getElementById('gb-save');if(save)save.onclick=function(){try{var u=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));var a=d.createElement('a');a.href=u;a.download='gameboot-'+code+'-report.json';a.click();setTimeout(function(){URL.revokeObjectURL(u);},30000);}catch(_){copy();}};
  };
  w.addEventListener('error',function(event){if(!w.GameBoot)w.GameBootEmergency('JS-BOOT',event.error || event.message || 'An early script failed.');},true);
  w.addEventListener('unhandledrejection',function(event){if(!w.GameBoot)w.GameBootEmergency('JS-BOOT',event.reason || 'An early promise failed.');});
}(window,document));
