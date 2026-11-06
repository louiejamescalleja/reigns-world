(function(root){
  const key='reigns-world-v1';
  const api={initial:null,mode:'unavailable',message:'',ready:null};
  let database=null,queue=Promise.resolve(),canWrite=true;
  function write(snapshot){return new Promise((resolve,reject)=>{const transaction=database.transaction('progress','readwrite'),store=transaction.objectStore('progress'),request=store.get('current');request.onsuccess=()=>{if((request.result?.shopRevision||0)>(snapshot.shopRevision||0)){transaction.abort();return;}store.put(snapshot,'current');};transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||new Error('Save interrupted'));});}
  function legacy(){let raw;try{raw=root.localStorage.getItem(key);}catch{return null;}if(!raw)return null;try{return JSON.parse(raw);}catch{return {invalidSavedData:true};}}
  api.ready=(async()=>{
    try{
      database=await new Promise((resolve,reject)=>{const request=root.indexedDB.open('reigns-world',1);request.onupgradeneeded=()=>request.result.createObjectStore('progress');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Storage is open in an older tab'));});
      database.onversionchange=()=>database.close();
      const current=await new Promise((resolve,reject)=>{const transaction=database.transaction('progress','readonly');const request=transaction.objectStore('progress').get('current');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      const value=current===undefined?legacy():current;
      if(value!==null&&value!==undefined&&!root.Garden.validate(value)){canWrite=false;api.message='Saved progress could not be read. Restore a valid backup in Grown-ups; the original save has been preserved.';}
      else if(value){api.initial=value;if(current===undefined)await write(value);}
      api.mode='IndexedDB';
    }catch{
      if(database){database.close();database=null;canWrite=false;api.message='Saved progress could not be opened safely. Reload or export a backup; existing data has been preserved.';return api.initial;}
      database=null;
      try{const probe=key+'-check';root.localStorage.setItem(probe,'1');root.localStorage.removeItem(probe);const value=legacy();if(value&&!root.Garden.validate(value)){canWrite=false;api.message='Saved progress could not be read. Restore a backup in Grown-ups.';}else api.initial=value;api.mode='localStorage';}catch{api.message='Saving is unavailable. Export a backup before closing the game.';}
    }
    return api.initial;
  })();
  api.save=(value,done=()=>{},replace=false)=>{
    const snapshot=JSON.parse(JSON.stringify(value));
    if(replace)canWrite=true;
    queue=queue.catch(()=>{}).then(async()=>{
      if(!canWrite||!root.Garden.validate(snapshot))throw new Error('Progress needs a valid backup restore');
      if(database)await write(snapshot);else if(api.mode==='localStorage')root.localStorage.setItem(key,JSON.stringify(snapshot));else throw new Error('Storage unavailable');
    }).then(()=>done(true)).catch(()=>done(false));
    return queue;
  };
  api.shopPurchase=async(value,id)=>{
    await queue;
    if(!canWrite)throw new Error('Saving unavailable');
    if(database)return new Promise((resolve,reject)=>{const transaction=database.transaction('progress','readwrite'),store=transaction.objectStore('progress'),request=store.get('current');let result;request.onsuccess=()=>{const current=request.result||JSON.parse(JSON.stringify(value));if(!root.Garden.validate(current)){transaction.abort();return;}const error=root.PetShop.purchase(current,id);result={value:current,error};if(!error)store.put(current,'current');};transaction.oncomplete=()=>resolve(result);transaction.onerror=transaction.onabort=()=>reject(new Error('Purchase could not save'));});
    const update=()=>{const current=legacy()||JSON.parse(JSON.stringify(value));if(!root.Garden.validate(current))throw new Error('Invalid save');const error=root.PetShop.purchase(current,id);if(!error)root.localStorage.setItem(key,JSON.stringify(current));return {value:current,error};};
    return root.navigator?.locks?root.navigator.locks.request('reigns-shop',update):update();
  };
  api.flush=()=>queue;
  root.GardenStorage=api;
})(typeof window!=='undefined'?window:globalThis);
