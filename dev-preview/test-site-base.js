// Shared mock + loader for zoom test pages
const MOCK_BOOKMARKS = [
  {id:"1",title:"拡張機能",url:"chrome://extensions/",isFolder:false},
  {id:"2",title:"",url:"https://google.com",isFolder:false},
  {id:"3",title:"",url:"https://photos.google.com",isFolder:false},
  {id:"4",title:"",url:"https://drive.google.com",isFolder:false},
  {id:"5",title:"",url:"https://calendar.google.com",isFolder:false},
  {id:"6",title:"Voicelabo",url:"https://voicelabo.com",isFolder:false},
  {id:"7",title:"Open WebUI",url:"https://openwebui.com",isFolder:false},
  {id:"8",title:"ボイラボ - Google スプレッドシート",url:"https://docs.google.com/1",isFolder:false},
  {id:"9",title:"CureArcana/DOUJIN_Viewer",url:"https://github.com/CureArcana",isFolder:false},
  {id:"10",title:"くらしTEPCO web",url:"https://kurashi.tepco.co.jp",isFolder:false},
  {id:"11",title:"実績 - 東方光耀夜攻略 Wiki*",url:"https://wikiwiki.jp/toho",isFolder:false},
  {id:"12",title:"新しいフォルダ",url:null,isFolder:true,children:[]},
  {id:"13",title:"紳士漫画倉庫 - ID同人誌",url:"https://example.com/13",isFolder:false},
  {id:"14",title:"DOUJIN VIEW - Google ス",url:"https://example.com/14",isFolder:false},
  {id:"15",title:"Codex",url:"https://example.com/15",isFolder:false},
  {id:"16",title:"",url:"https://example.com/16",isFolder:false},
  {id:"17",title:"ホーム / X",url:"https://x.com",isFolder:false},
  {id:"18",title:"Claude",url:"https://claude.ai",isFolder:false},
  {id:"19",title:"",url:"https://example.com/19",isFolder:false},
  {id:"20",title:"Btsu",url:"https://8tsu.net",isFolder:false},
  {id:"21",title:"",url:"https://example.com/21",isFolder:false},
  {id:"22",title:"a",url:"https://example.com/22",isFolder:false},
  {id:"23",title:"領収",url:"https://example.com/23",isFolder:false},
  {id:"24",title:"キャラ一覧",url:"https://example.com/24",isFolder:false},
  {id:"25",title:"Develop",url:null,isFolder:true,children:[]},
  {id:"26",title:"第十六堂 - アズールレーン",url:"https://example.com/26",isFolder:false},
  {id:"27",title:"しんしん @SSnSn",url:"https://x.com/SSnSn",isFolder:false},
  {id:"28",title:"動画・配信",url:null,isFolder:true,children:[]},
  {id:"29",title:"web",url:null,isFolder:true,children:[]},
  {id:"30",title:"Sign In | WFMGR",url:"https://example.com/30",isFolder:false},
  {id:"31",title:"タオバオ代行",url:"https://example.com/31",isFolder:false},
  {id:"32",title:"2ch",url:"https://example.com/32",isFolder:false},
  {id:"33",title:"楽天証券",url:"https://example.com/33",isFolder:false},
  {id:"34",title:"YouTube",url:"https://youtube.com",isFolder:false},
  {id:"35",title:"freee開業",url:"https://example.com/35",isFolder:false},
];

window.chrome = {
  runtime: {
    getURL: (p) => p,
    sendMessage: (msg, cb) => {
      if (msg.type === 'MRBB_GET_BOOKMARKS') setTimeout(() => cb({bookmarks: MOCK_BOOKMARKS}), 10);
      else setTimeout(() => cb && cb({success: true}), 10);
      return true;
    },
    onMessage: { addListener: () => {} },
    lastError: null
  },
  storage: {
    sync: { get: () => Promise.resolve({}), set: () => Promise.resolve() },
    onChanged: { addListener: () => {} }
  }
};

function loadExtension() {
  const s = document.createElement('script');
  s.src = 'content.js';
  s.onload = () => {
    setTimeout(() => {
      const h = document.getElementById('mrbb-host');
      const info = document.getElementById('zoom-info');
      if (h && info) {
        const shadow = h.shadowRoot;
        const item = shadow?.querySelector('.mrbb-item');
        const itemCS = item ? getComputedStyle(item) : null;
        info.textContent = `DPR=${devicePixelRatio.toFixed(2)} | innerW=${innerWidth} | ` +
          `font=${itemCS?.fontSize} | rowH=${shadow?.querySelector('.mrbb-row:not(.mrbb-row-hidden)')?.getBoundingClientRect().height.toFixed(1)}px | ` +
          `zoom=${(screen.width/innerWidth).toFixed(2)}`;
      }
    }, 500);
  };
  document.body.appendChild(s);
}
