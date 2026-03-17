(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[1510],{46946:function(e){"use strict";var t={single_source_shortest_paths:function(e,o,i){var r,n,l,a,s,c,d,u={},h={};h[o]=0;var p=t.PriorityQueue.make();for(p.push(o,0);!p.empty();)for(l in n=(r=p.pop()).value,a=r.cost,s=e[n]||{})s.hasOwnProperty(l)&&(c=a+s[l],d=h[l],(void 0===h[l]||d>c)&&(h[l]=c,p.push(l,c),u[l]=n));if(void 0!==i&&void 0===h[i])throw Error(["Could not find a path from ",o," to ",i,"."].join(""));return u},extract_shortest_path_from_predecessor_list:function(e,t){for(var o=[],i=t;i;)o.push(i),e[i],i=e[i];return o.reverse(),o},find_path:function(e,o,i){var r=t.single_source_shortest_paths(e,o,i);return t.extract_shortest_path_from_predecessor_list(r,i)},PriorityQueue:{make:function(e){var o,i=t.PriorityQueue,r={};for(o in e=e||{},i)i.hasOwnProperty(o)&&(r[o]=i[o]);return r.queue=[],r.sorter=e.sorter||i.default_sorter,r},default_sorter:function(e,t){return e.cost-t.cost},push:function(e,t){this.queue.push({value:e,cost:t}),this.queue.sort(this.sorter)},pop:function(){return this.queue.shift()},empty:function(){return 0===this.queue.length}}};e.exports=t},8878:function(e){"use strict";e.exports=function(e){for(var t=[],o=e.length,i=0;i<o;i++){var r=e.charCodeAt(i);if(r>=55296&&r<=56319&&o>i+1){var n=e.charCodeAt(i+1);n>=56320&&n<=57343&&(r=(r-55296)*1024+n-56320+65536,i+=1)}if(r<128){t.push(r);continue}if(r<2048){t.push(r>>6|192),t.push(63&r|128);continue}if(r<55296||r>=57344&&r<65536){t.push(r>>12|224),t.push(r>>6&63|128),t.push(63&r|128);continue}if(r>=65536&&r<=1114111){t.push(r>>18|240),t.push(r>>12&63|128),t.push(r>>6&63|128),t.push(63&r|128);continue}t.push(239,191,189)}return new Uint8Array(t).buffer}},35819:function(e,t,o){let i=o(64888),r=o(82216),n=o(962),l=o(35623);function a(e,t,o,n,l){let a=[].slice.call(arguments,1),s=a.length,c="function"==typeof a[s-1];if(!c&&!i())throw Error("Callback required as last argument");if(c){if(s<2)throw Error("Too few arguments provided");2===s?(l=o,o=t,t=n=void 0):3===s&&(t.getContext&&void 0===l?(l=n,n=void 0):(l=n,n=o,o=t,t=void 0))}else{if(s<1)throw Error("Too few arguments provided");return 1===s?(o=t,t=n=void 0):2!==s||t.getContext||(n=o,o=t,t=void 0),new Promise(function(i,l){try{let l=r.create(o,n);i(e(l,t,n))}catch(e){l(e)}})}try{let i=r.create(o,n);l(null,e(i,t,n))}catch(e){l(e)}}t.create=r.create,t.toCanvas=a.bind(null,n.render),t.toDataURL=a.bind(null,n.renderToDataURL),t.toString=a.bind(null,function(e,t,o){return l.render(e,o)})},64888:function(e){e.exports=function(){return"function"==typeof Promise&&Promise.prototype&&Promise.prototype.then}},14691:function(e,t,o){let i=o(62415).getSymbolSize;t.getRowColCoords=function(e){if(1===e)return[];let t=Math.floor(e/7)+2,o=i(e),r=145===o?26:2*Math.ceil((o-13)/(2*t-2)),n=[o-7];for(let e=1;e<t-1;e++)n[e]=n[e-1]-r;return n.push(6),n.reverse()},t.getPositions=function(e){let o=[],i=t.getRowColCoords(e),r=i.length;for(let e=0;e<r;e++)for(let t=0;t<r;t++)(0!==e||0!==t)&&(0!==e||t!==r-1)&&(e!==r-1||0!==t)&&o.push([i[e],i[t]]);return o}},87111:function(e,t,o){let i=o(17956),r=["0","1","2","3","4","5","6","7","8","9","A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z"," ","$","%","*","+","-",".","/",":"];function n(e){this.mode=i.ALPHANUMERIC,this.data=e}n.getBitsLength=function(e){return 11*Math.floor(e/2)+e%2*6},n.prototype.getLength=function(){return this.data.length},n.prototype.getBitsLength=function(){return n.getBitsLength(this.data.length)},n.prototype.write=function(e){let t;for(t=0;t+2<=this.data.length;t+=2){let o=45*r.indexOf(this.data[t]);o+=r.indexOf(this.data[t+1]),e.put(o,11)}this.data.length%2&&e.put(r.indexOf(this.data[t]),6)},e.exports=n},9298:function(e){function t(){this.buffer=[],this.length=0}t.prototype={get:function(e){return(this.buffer[Math.floor(e/8)]>>>7-e%8&1)==1},put:function(e,t){for(let o=0;o<t;o++)this.putBit((e>>>t-o-1&1)==1)},getLengthInBits:function(){return this.length},putBit:function(e){let t=Math.floor(this.length/8);this.buffer.length<=t&&this.buffer.push(0),e&&(this.buffer[t]|=128>>>this.length%8),this.length++}},e.exports=t},55526:function(e){function t(e){if(!e||e<1)throw Error("BitMatrix size must be defined and greater than 0");this.size=e,this.data=new Uint8Array(e*e),this.reservedBit=new Uint8Array(e*e)}t.prototype.set=function(e,t,o,i){let r=e*this.size+t;this.data[r]=o,i&&(this.reservedBit[r]=!0)},t.prototype.get=function(e,t){return this.data[e*this.size+t]},t.prototype.xor=function(e,t,o){this.data[e*this.size+t]^=o},t.prototype.isReserved=function(e,t){return this.reservedBit[e*this.size+t]},e.exports=t},48153:function(e,t,o){let i=o(8878),r=o(17956);function n(e){this.mode=r.BYTE,"string"==typeof e&&(e=i(e)),this.data=new Uint8Array(e)}n.getBitsLength=function(e){return 8*e},n.prototype.getLength=function(){return this.data.length},n.prototype.getBitsLength=function(){return n.getBitsLength(this.data.length)},n.prototype.write=function(e){for(let t=0,o=this.data.length;t<o;t++)e.put(this.data[t],8)},e.exports=n},79386:function(e,t,o){let i=o(29947),r=[1,1,1,1,1,1,1,1,1,1,2,2,1,2,2,4,1,2,4,4,2,4,4,4,2,4,6,5,2,4,6,6,2,5,8,8,4,5,8,8,4,5,8,11,4,8,10,11,4,9,12,16,4,9,16,16,6,10,12,18,6,10,17,16,6,11,16,19,6,13,18,21,7,14,21,25,8,16,20,25,8,17,23,25,9,17,23,34,9,18,25,30,10,20,27,32,12,21,29,35,12,23,34,37,12,25,34,40,13,26,35,42,14,28,38,45,15,29,40,48,16,31,43,51,17,33,45,54,18,35,48,57,19,37,51,60,19,38,53,63,20,40,56,66,21,43,59,70,22,45,62,74,24,47,65,77,25,49,68,81],n=[7,10,13,17,10,16,22,28,15,26,36,44,20,36,52,64,26,48,72,88,36,64,96,112,40,72,108,130,48,88,132,156,60,110,160,192,72,130,192,224,80,150,224,264,96,176,260,308,104,198,288,352,120,216,320,384,132,240,360,432,144,280,408,480,168,308,448,532,180,338,504,588,196,364,546,650,224,416,600,700,224,442,644,750,252,476,690,816,270,504,750,900,300,560,810,960,312,588,870,1050,336,644,952,1110,360,700,1020,1200,390,728,1050,1260,420,784,1140,1350,450,812,1200,1440,480,868,1290,1530,510,924,1350,1620,540,980,1440,1710,570,1036,1530,1800,570,1064,1590,1890,600,1120,1680,1980,630,1204,1770,2100,660,1260,1860,2220,720,1316,1950,2310,750,1372,2040,2430];t.getBlocksCount=function(e,t){switch(t){case i.L:return r[(e-1)*4+0];case i.M:return r[(e-1)*4+1];case i.Q:return r[(e-1)*4+2];case i.H:return r[(e-1)*4+3];default:return}},t.getTotalCodewordsCount=function(e,t){switch(t){case i.L:return n[(e-1)*4+0];case i.M:return n[(e-1)*4+1];case i.Q:return n[(e-1)*4+2];case i.H:return n[(e-1)*4+3];default:return}}},29947:function(e,t){t.L={bit:1},t.M={bit:0},t.Q={bit:3},t.H={bit:2},t.isValid=function(e){return e&&void 0!==e.bit&&e.bit>=0&&e.bit<4},t.from=function(e,o){if(t.isValid(e))return e;try{return function(e){if("string"!=typeof e)throw Error("Param is not a string");switch(e.toLowerCase()){case"l":case"low":return t.L;case"m":case"medium":return t.M;case"q":case"quartile":return t.Q;case"h":case"high":return t.H;default:throw Error("Unknown EC Level: "+e)}}(e)}catch(e){return o}}},85512:function(e,t,o){let i=o(62415).getSymbolSize;t.getPositions=function(e){let t=i(e);return[[0,0],[t-7,0],[0,t-7]]}},27433:function(e,t,o){let i=o(62415),r=i.getBCHDigit(1335);t.getEncodedBits=function(e,t){let o=e.bit<<3|t,n=o<<10;for(;i.getBCHDigit(n)-r>=0;)n^=1335<<i.getBCHDigit(n)-r;return(o<<10|n)^21522}},63384:function(e,t){let o=new Uint8Array(512),i=new Uint8Array(256);!function(){let e=1;for(let t=0;t<255;t++)o[t]=e,i[e]=t,256&(e<<=1)&&(e^=285);for(let e=255;e<512;e++)o[e]=o[e-255]}(),t.log=function(e){if(e<1)throw Error("log("+e+")");return i[e]},t.exp=function(e){return o[e]},t.mul=function(e,t){return 0===e||0===t?0:o[i[e]+i[t]]}},78514:function(e,t,o){let i=o(17956),r=o(62415);function n(e){this.mode=i.KANJI,this.data=e}n.getBitsLength=function(e){return 13*e},n.prototype.getLength=function(){return this.data.length},n.prototype.getBitsLength=function(){return n.getBitsLength(this.data.length)},n.prototype.write=function(e){let t;for(t=0;t<this.data.length;t++){let o=r.toSJIS(this.data[t]);if(o>=33088&&o<=40956)o-=33088;else if(o>=57408&&o<=60351)o-=49472;else throw Error("Invalid SJIS character: "+this.data[t]+"\nMake sure your charset is UTF-8");o=(o>>>8&255)*192+(255&o),e.put(o,13)}},e.exports=n},24483:function(e,t){t.Patterns={PATTERN000:0,PATTERN001:1,PATTERN010:2,PATTERN011:3,PATTERN100:4,PATTERN101:5,PATTERN110:6,PATTERN111:7};let o={N1:3,N2:3,N3:40,N4:10};t.isValid=function(e){return null!=e&&""!==e&&!isNaN(e)&&e>=0&&e<=7},t.from=function(e){return t.isValid(e)?parseInt(e,10):void 0},t.getPenaltyN1=function(e){let t=e.size,i=0,r=0,n=0,l=null,a=null;for(let s=0;s<t;s++){r=n=0,l=a=null;for(let c=0;c<t;c++){let t=e.get(s,c);t===l?r++:(r>=5&&(i+=o.N1+(r-5)),l=t,r=1),(t=e.get(c,s))===a?n++:(n>=5&&(i+=o.N1+(n-5)),a=t,n=1)}r>=5&&(i+=o.N1+(r-5)),n>=5&&(i+=o.N1+(n-5))}return i},t.getPenaltyN2=function(e){let t=e.size,i=0;for(let o=0;o<t-1;o++)for(let r=0;r<t-1;r++){let t=e.get(o,r)+e.get(o,r+1)+e.get(o+1,r)+e.get(o+1,r+1);(4===t||0===t)&&i++}return i*o.N2},t.getPenaltyN3=function(e){let t=e.size,i=0,r=0,n=0;for(let o=0;o<t;o++){r=n=0;for(let l=0;l<t;l++)r=r<<1&2047|e.get(o,l),l>=10&&(1488===r||93===r)&&i++,n=n<<1&2047|e.get(l,o),l>=10&&(1488===n||93===n)&&i++}return i*o.N3},t.getPenaltyN4=function(e){let t=0,i=e.data.length;for(let o=0;o<i;o++)t+=e.data[o];return Math.abs(Math.ceil(100*t/i/5)-10)*o.N4},t.applyMask=function(e,o){let i=o.size;for(let r=0;r<i;r++)for(let n=0;n<i;n++)o.isReserved(n,r)||o.xor(n,r,function(e,o,i){switch(e){case t.Patterns.PATTERN000:return(o+i)%2==0;case t.Patterns.PATTERN001:return o%2==0;case t.Patterns.PATTERN010:return i%3==0;case t.Patterns.PATTERN011:return(o+i)%3==0;case t.Patterns.PATTERN100:return(Math.floor(o/2)+Math.floor(i/3))%2==0;case t.Patterns.PATTERN101:return o*i%2+o*i%3==0;case t.Patterns.PATTERN110:return(o*i%2+o*i%3)%2==0;case t.Patterns.PATTERN111:return(o*i%3+(o+i)%2)%2==0;default:throw Error("bad maskPattern:"+e)}}(e,n,r))},t.getBestMask=function(e,o){let i=Object.keys(t.Patterns).length,r=0,n=1/0;for(let l=0;l<i;l++){o(l),t.applyMask(l,e);let i=t.getPenaltyN1(e)+t.getPenaltyN2(e)+t.getPenaltyN3(e)+t.getPenaltyN4(e);t.applyMask(l,e),i<n&&(n=i,r=l)}return r}},17956:function(e,t,o){let i=o(96623),r=o(80581);t.NUMERIC={id:"Numeric",bit:1,ccBits:[10,12,14]},t.ALPHANUMERIC={id:"Alphanumeric",bit:2,ccBits:[9,11,13]},t.BYTE={id:"Byte",bit:4,ccBits:[8,16,16]},t.KANJI={id:"Kanji",bit:8,ccBits:[8,10,12]},t.MIXED={bit:-1},t.getCharCountIndicator=function(e,t){if(!e.ccBits)throw Error("Invalid mode: "+e);if(!i.isValid(t))throw Error("Invalid version: "+t);return t>=1&&t<10?e.ccBits[0]:t<27?e.ccBits[1]:e.ccBits[2]},t.getBestModeForData=function(e){return r.testNumeric(e)?t.NUMERIC:r.testAlphanumeric(e)?t.ALPHANUMERIC:r.testKanji(e)?t.KANJI:t.BYTE},t.toString=function(e){if(e&&e.id)return e.id;throw Error("Invalid mode")},t.isValid=function(e){return e&&e.bit&&e.ccBits},t.from=function(e,o){if(t.isValid(e))return e;try{return function(e){if("string"!=typeof e)throw Error("Param is not a string");switch(e.toLowerCase()){case"numeric":return t.NUMERIC;case"alphanumeric":return t.ALPHANUMERIC;case"kanji":return t.KANJI;case"byte":return t.BYTE;default:throw Error("Unknown mode: "+e)}}(e)}catch(e){return o}}},51687:function(e,t,o){let i=o(17956);function r(e){this.mode=i.NUMERIC,this.data=e.toString()}r.getBitsLength=function(e){return 10*Math.floor(e/3)+(e%3?e%3*3+1:0)},r.prototype.getLength=function(){return this.data.length},r.prototype.getBitsLength=function(){return r.getBitsLength(this.data.length)},r.prototype.write=function(e){let t,o;for(t=0;t+3<=this.data.length;t+=3)o=parseInt(this.data.substr(t,3),10),e.put(o,10);let i=this.data.length-t;i>0&&(o=parseInt(this.data.substr(t),10),e.put(o,3*i+1))},e.exports=r},46413:function(e,t,o){let i=o(63384);t.mul=function(e,t){let o=new Uint8Array(e.length+t.length-1);for(let r=0;r<e.length;r++)for(let n=0;n<t.length;n++)o[r+n]^=i.mul(e[r],t[n]);return o},t.mod=function(e,t){let o=new Uint8Array(e);for(;o.length-t.length>=0;){let e=o[0];for(let r=0;r<t.length;r++)o[r]^=i.mul(t[r],e);let r=0;for(;r<o.length&&0===o[r];)r++;o=o.slice(r)}return o},t.generateECPolynomial=function(e){let o=new Uint8Array([1]);for(let r=0;r<e;r++)o=t.mul(o,new Uint8Array([1,i.exp(r)]));return o}},82216:function(e,t,o){let i=o(62415),r=o(29947),n=o(9298),l=o(55526),a=o(14691),s=o(85512),c=o(24483),d=o(79386),u=o(24011),h=o(33379),p=o(27433),g=o(17956),f=o(89940);function w(e,t,o){let i,r;let n=e.size,l=p.getEncodedBits(t,o);for(i=0;i<15;i++)r=(l>>i&1)==1,i<6?e.set(i,8,r,!0):i<8?e.set(i+1,8,r,!0):e.set(n-15+i,8,r,!0),i<8?e.set(8,n-i-1,r,!0):i<9?e.set(8,15-i-1+1,r,!0):e.set(8,15-i-1,r,!0);e.set(n-8,8,1,!0)}t.create=function(e,t){let o,p;if(void 0===e||""===e)throw Error("No input text");let m=r.M;return void 0!==t&&(m=r.from(t.errorCorrectionLevel,r.M),o=h.from(t.version),p=c.from(t.maskPattern),t.toSJISFunc&&i.setToSJISFunction(t.toSJISFunc)),function(e,t,o,r){let p;if(Array.isArray(e))p=f.fromArray(e);else if("string"==typeof e){let i=t;if(!i){let t=f.rawSplit(e);i=h.getBestVersionForData(t,o)}p=f.fromString(e,i||40)}else throw Error("Invalid data");let m=h.getBestVersionForData(p,o);if(!m)throw Error("The amount of data is too big to be stored in a QR Code");if(t){if(t<m)throw Error("\nThe chosen QR Code version cannot contain this amount of data.\nMinimum version required to store current data is: "+m+".\n")}else t=m;let b=function(e,t,o){let r=new n;o.forEach(function(t){r.put(t.mode.bit,4),r.put(t.getLength(),g.getCharCountIndicator(t.mode,e)),t.write(r)});let l=(i.getSymbolTotalCodewords(e)-d.getTotalCodewordsCount(e,t))*8;for(r.getLengthInBits()+4<=l&&r.put(0,4);r.getLengthInBits()%8!=0;)r.putBit(0);let a=(l-r.getLengthInBits())/8;for(let e=0;e<a;e++)r.put(e%2?17:236,8);return function(e,t,o){let r,n;let l=i.getSymbolTotalCodewords(t),a=l-d.getTotalCodewordsCount(t,o),s=d.getBlocksCount(t,o),c=l%s,h=s-c,p=Math.floor(l/s),g=Math.floor(a/s),f=g+1,w=p-g,m=new u(w),b=0,y=Array(s),v=Array(s),C=0,x=new Uint8Array(e.buffer);for(let e=0;e<s;e++){let t=e<h?g:f;y[e]=x.slice(b,b+t),v[e]=m.encode(y[e]),b+=t,C=Math.max(C,t)}let $=new Uint8Array(l),R=0;for(r=0;r<C;r++)for(n=0;n<s;n++)r<y[n].length&&($[R++]=y[n][r]);for(r=0;r<w;r++)for(n=0;n<s;n++)$[R++]=v[n][r];return $}(r,e,t)}(t,o,p),y=new l(i.getSymbolSize(t));return function(e,t){let o=e.size,i=s.getPositions(t);for(let t=0;t<i.length;t++){let r=i[t][0],n=i[t][1];for(let t=-1;t<=7;t++)if(!(r+t<=-1)&&!(o<=r+t))for(let i=-1;i<=7;i++)n+i<=-1||o<=n+i||(t>=0&&t<=6&&(0===i||6===i)||i>=0&&i<=6&&(0===t||6===t)||t>=2&&t<=4&&i>=2&&i<=4?e.set(r+t,n+i,!0,!0):e.set(r+t,n+i,!1,!0))}}(y,t),function(e){let t=e.size;for(let o=8;o<t-8;o++){let t=o%2==0;e.set(o,6,t,!0),e.set(6,o,t,!0)}}(y),function(e,t){let o=a.getPositions(t);for(let t=0;t<o.length;t++){let i=o[t][0],r=o[t][1];for(let t=-2;t<=2;t++)for(let o=-2;o<=2;o++)-2===t||2===t||-2===o||2===o||0===t&&0===o?e.set(i+t,r+o,!0,!0):e.set(i+t,r+o,!1,!0)}}(y,t),w(y,o,0),t>=7&&function(e,t){let o,i,r;let n=e.size,l=h.getEncodedBits(t);for(let t=0;t<18;t++)o=Math.floor(t/3),i=t%3+n-8-3,r=(l>>t&1)==1,e.set(o,i,r,!0),e.set(i,o,r,!0)}(y,t),function(e,t){let o=e.size,i=-1,r=o-1,n=7,l=0;for(let a=o-1;a>0;a-=2)for(6===a&&a--;;){for(let o=0;o<2;o++)if(!e.isReserved(r,a-o)){let i=!1;l<t.length&&(i=(t[l]>>>n&1)==1),e.set(r,a-o,i),-1==--n&&(l++,n=7)}if((r+=i)<0||o<=r){r-=i,i=-i;break}}}(y,b),isNaN(r)&&(r=c.getBestMask(y,w.bind(null,y,o))),c.applyMask(r,y),w(y,o,r),{modules:y,version:t,errorCorrectionLevel:o,maskPattern:r,segments:p}}(e,o,m,p)}},24011:function(e,t,o){let i=o(46413);function r(e){this.genPoly=void 0,this.degree=e,this.degree&&this.initialize(this.degree)}r.prototype.initialize=function(e){this.degree=e,this.genPoly=i.generateECPolynomial(this.degree)},r.prototype.encode=function(e){if(!this.genPoly)throw Error("Encoder not initialized");let t=new Uint8Array(e.length+this.degree);t.set(e);let o=i.mod(t,this.genPoly),r=this.degree-o.length;if(r>0){let e=new Uint8Array(this.degree);return e.set(o,r),e}return o},e.exports=r},80581:function(e,t){let o="[0-9]+",i="(?:[u3000-u303F]|[u3040-u309F]|[u30A0-u30FF]|[uFF00-uFFEF]|[u4E00-u9FAF]|[u2605-u2606]|[u2190-u2195]|u203B|[u2010u2015u2018u2019u2025u2026u201Cu201Du2225u2260]|[u0391-u0451]|[u00A7u00A8u00B1u00B4u00D7u00F7])+",r="(?:(?![A-Z0-9 $%*+\\-./:]|"+(i=i.replace(/u/g,"\\u"))+")(?:.|[\r\n]))+";t.KANJI=RegExp(i,"g"),t.BYTE_KANJI=RegExp("[^A-Z0-9 $%*+\\-./:]+","g"),t.BYTE=RegExp(r,"g"),t.NUMERIC=RegExp(o,"g"),t.ALPHANUMERIC=RegExp("[A-Z $%*+\\-./:]+","g");let n=RegExp("^"+i+"$"),l=RegExp("^"+o+"$"),a=RegExp("^[A-Z0-9 $%*+\\-./:]+$");t.testKanji=function(e){return n.test(e)},t.testNumeric=function(e){return l.test(e)},t.testAlphanumeric=function(e){return a.test(e)}},89940:function(e,t,o){let i=o(17956),r=o(51687),n=o(87111),l=o(48153),a=o(78514),s=o(80581),c=o(62415),d=o(46946);function u(e){return unescape(encodeURIComponent(e)).length}function h(e,t,o){let i;let r=[];for(;null!==(i=e.exec(o));)r.push({data:i[0],index:i.index,mode:t,length:i[0].length});return r}function p(e){let t,o;let r=h(s.NUMERIC,i.NUMERIC,e),n=h(s.ALPHANUMERIC,i.ALPHANUMERIC,e);return c.isKanjiModeEnabled()?(t=h(s.BYTE,i.BYTE,e),o=h(s.KANJI,i.KANJI,e)):(t=h(s.BYTE_KANJI,i.BYTE,e),o=[]),r.concat(n,t,o).sort(function(e,t){return e.index-t.index}).map(function(e){return{data:e.data,mode:e.mode,length:e.length}})}function g(e,t){switch(t){case i.NUMERIC:return r.getBitsLength(e);case i.ALPHANUMERIC:return n.getBitsLength(e);case i.KANJI:return a.getBitsLength(e);case i.BYTE:return l.getBitsLength(e)}}function f(e,t){let o;let s=i.getBestModeForData(e);if((o=i.from(t,s))!==i.BYTE&&o.bit<s.bit)throw Error('"'+e+'" cannot be encoded with mode '+i.toString(o)+".\n Suggested mode is: "+i.toString(s));switch(o!==i.KANJI||c.isKanjiModeEnabled()||(o=i.BYTE),o){case i.NUMERIC:return new r(e);case i.ALPHANUMERIC:return new n(e);case i.KANJI:return new a(e);case i.BYTE:return new l(e)}}t.fromArray=function(e){return e.reduce(function(e,t){return"string"==typeof t?e.push(f(t,null)):t.data&&e.push(f(t.data,t.mode)),e},[])},t.fromString=function(e,o){let r=function(e,t){let o={},r={start:{}},n=["start"];for(let l=0;l<e.length;l++){let a=e[l],s=[];for(let e=0;e<a.length;e++){let c=a[e],d=""+l+e;s.push(d),o[d]={node:c,lastCount:0},r[d]={};for(let e=0;e<n.length;e++){let l=n[e];o[l]&&o[l].node.mode===c.mode?(r[l][d]=g(o[l].lastCount+c.length,c.mode)-g(o[l].lastCount,c.mode),o[l].lastCount+=c.length):(o[l]&&(o[l].lastCount=c.length),r[l][d]=g(c.length,c.mode)+4+i.getCharCountIndicator(c.mode,t))}}n=s}for(let e=0;e<n.length;e++)r[n[e]].end=0;return{map:r,table:o}}(function(e){let t=[];for(let o=0;o<e.length;o++){let r=e[o];switch(r.mode){case i.NUMERIC:t.push([r,{data:r.data,mode:i.ALPHANUMERIC,length:r.length},{data:r.data,mode:i.BYTE,length:r.length}]);break;case i.ALPHANUMERIC:t.push([r,{data:r.data,mode:i.BYTE,length:r.length}]);break;case i.KANJI:t.push([r,{data:r.data,mode:i.BYTE,length:u(r.data)}]);break;case i.BYTE:t.push([{data:r.data,mode:i.BYTE,length:u(r.data)}])}}return t}(p(e,c.isKanjiModeEnabled())),o),n=d.find_path(r.map,"start","end"),l=[];for(let e=1;e<n.length-1;e++)l.push(r.table[n[e]].node);return t.fromArray(l.reduce(function(e,t){let o=e.length-1>=0?e[e.length-1]:null;return o&&o.mode===t.mode?e[e.length-1].data+=t.data:e.push(t),e},[]))},t.rawSplit=function(e){return t.fromArray(p(e,c.isKanjiModeEnabled()))}},62415:function(e,t){let o;let i=[0,26,44,70,100,134,172,196,242,292,346,404,466,532,581,655,733,815,901,991,1085,1156,1258,1364,1474,1588,1706,1828,1921,2051,2185,2323,2465,2611,2761,2876,3034,3196,3362,3532,3706];t.getSymbolSize=function(e){if(!e)throw Error('"version" cannot be null or undefined');if(e<1||e>40)throw Error('"version" should be in range from 1 to 40');return 4*e+17},t.getSymbolTotalCodewords=function(e){return i[e]},t.getBCHDigit=function(e){let t=0;for(;0!==e;)t++,e>>>=1;return t},t.setToSJISFunction=function(e){if("function"!=typeof e)throw Error('"toSJISFunc" is not a valid function.');o=e},t.isKanjiModeEnabled=function(){return void 0!==o},t.toSJIS=function(e){return o(e)}},96623:function(e,t){t.isValid=function(e){return!isNaN(e)&&e>=1&&e<=40}},33379:function(e,t,o){let i=o(62415),r=o(79386),n=o(29947),l=o(17956),a=o(96623),s=i.getBCHDigit(7973);function c(e,t){return l.getCharCountIndicator(e,t)+4}t.from=function(e,t){return a.isValid(e)?parseInt(e,10):t},t.getCapacity=function(e,t,o){if(!a.isValid(e))throw Error("Invalid QR Code version");void 0===o&&(o=l.BYTE);let n=(i.getSymbolTotalCodewords(e)-r.getTotalCodewordsCount(e,t))*8;if(o===l.MIXED)return n;let s=n-c(o,e);switch(o){case l.NUMERIC:return Math.floor(s/10*3);case l.ALPHANUMERIC:return Math.floor(s/11*2);case l.KANJI:return Math.floor(s/13);case l.BYTE:default:return Math.floor(s/8)}},t.getBestVersionForData=function(e,o){let i;let r=n.from(o,n.M);if(Array.isArray(e)){if(e.length>1)return function(e,o){for(let i=1;i<=40;i++)if(function(e,t){let o=0;return e.forEach(function(e){let i=c(e.mode,t);o+=i+e.getBitsLength()}),o}(e,i)<=t.getCapacity(i,o,l.MIXED))return i}(e,r);if(0===e.length)return 1;i=e[0]}else i=e;return function(e,o,i){for(let r=1;r<=40;r++)if(o<=t.getCapacity(r,i,e))return r}(i.mode,i.getLength(),r)},t.getEncodedBits=function(e){if(!a.isValid(e)||e<7)throw Error("Invalid QR Code version");let t=e<<12;for(;i.getBCHDigit(t)-s>=0;)t^=7973<<i.getBCHDigit(t)-s;return e<<12|t}},962:function(e,t,o){let i=o(87220);t.render=function(e,t,o){var r;let n=o,l=t;void 0!==n||t&&t.getContext||(n=t,t=void 0),t||(l=function(){try{return document.createElement("canvas")}catch(e){throw Error("You need to specify a canvas element")}}()),n=i.getOptions(n);let a=i.getImageWidth(e.modules.size,n),s=l.getContext("2d"),c=s.createImageData(a,a);return i.qrToImageData(c.data,e,n),r=l,s.clearRect(0,0,r.width,r.height),r.style||(r.style={}),r.height=a,r.width=a,r.style.height=a+"px",r.style.width=a+"px",s.putImageData(c,0,0),l},t.renderToDataURL=function(e,o,i){let r=i;void 0!==r||o&&o.getContext||(r=o,o=void 0),r||(r={});let n=t.render(e,o,r),l=r.type||"image/png",a=r.rendererOpts||{};return n.toDataURL(l,a.quality)}},35623:function(e,t,o){let i=o(87220);function r(e,t){let o=e.a/255,i=t+'="'+e.hex+'"';return o<1?i+" "+t+'-opacity="'+o.toFixed(2).slice(1)+'"':i}function n(e,t,o){let i=e+t;return void 0!==o&&(i+=" "+o),i}t.render=function(e,t,o){let l=i.getOptions(t),a=e.modules.size,s=e.modules.data,c=a+2*l.margin,d=l.color.light.a?"<path "+r(l.color.light,"fill")+' d="M0 0h'+c+"v"+c+'H0z"/>':"",u="<path "+r(l.color.dark,"stroke")+' d="'+function(e,t,o){let i="",r=0,l=!1,a=0;for(let s=0;s<e.length;s++){let c=Math.floor(s%t),d=Math.floor(s/t);c||l||(l=!0),e[s]?(a++,s>0&&c>0&&e[s-1]||(i+=l?n("M",c+o,.5+d+o):n("m",r,0),r=0,l=!1),c+1<t&&e[s+1]||(i+=n("h",a),a=0)):r++}return i}(s,a,l.margin)+'"/>',h='<svg xmlns="http://www.w3.org/2000/svg" '+(l.width?'width="'+l.width+'" height="'+l.width+'" ':"")+('viewBox="0 0 '+c)+" "+c+'" shape-rendering="crispEdges">'+d+u+"</svg>\n";return"function"==typeof o&&o(null,h),h}},87220:function(e,t){function o(e){if("number"==typeof e&&(e=e.toString()),"string"!=typeof e)throw Error("Color should be defined as hex string");let t=e.slice().replace("#","").split("");if(t.length<3||5===t.length||t.length>8)throw Error("Invalid hex color: "+e);(3===t.length||4===t.length)&&(t=Array.prototype.concat.apply([],t.map(function(e){return[e,e]}))),6===t.length&&t.push("F","F");let o=parseInt(t.join(""),16);return{r:o>>24&255,g:o>>16&255,b:o>>8&255,a:255&o,hex:"#"+t.slice(0,6).join("")}}t.getOptions=function(e){e||(e={}),e.color||(e.color={});let t=void 0===e.margin||null===e.margin||e.margin<0?4:e.margin,i=e.width&&e.width>=21?e.width:void 0,r=e.scale||4;return{width:i,scale:i?4:r,margin:t,color:{dark:o(e.color.dark||"#000000ff"),light:o(e.color.light||"#ffffffff")},type:e.type,rendererOpts:e.rendererOpts||{}}},t.getScale=function(e,t){return t.width&&t.width>=e+2*t.margin?t.width/(e+2*t.margin):t.scale},t.getImageWidth=function(e,o){let i=t.getScale(e,o);return Math.floor((e+2*o.margin)*i)},t.qrToImageData=function(e,o,i){let r=o.modules.size,n=o.modules.data,l=t.getScale(r,i),a=Math.floor((r+2*i.margin)*l),s=i.margin*l,c=[i.color.light,i.color.dark];for(let t=0;t<a;t++)for(let o=0;o<a;o++){let d=(t*a+o)*4,u=i.color.light;t>=s&&o>=s&&t<a-s&&o<a-s&&(u=c[n[Math.floor((t-s)/l)*r+Math.floor((o-s)/l)]?1:0]),e[d++]=u.r,e[d++]=u.g,e[d++]=u.b,e[d]=u.a}}},71510:function(e,t,o){"use strict";o.r(t),o.d(t,{W3mAllWalletsView:function(){return tc},W3mConnectingWcBasicView:function(){return eE},W3mDownloadsView:function(){return td}});var i=o(31133),r=o(19848),n=o(53357),l=o(5688),a=o(17766),s=o(36801),c=o(30795);o(96277);var d=o(32801),u=o(44649),h=o(35652),p=o(29562),g=o(31929),f=o(86777);o(97928);var w=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let m=class extends i.oi{constructor(){super(),this.unsubscribe=[],this.tabIdx=void 0,this.connectors=h.ConnectorController.state.connectors,this.count=a.ApiController.state.count,this.filteredCount=a.ApiController.state.filteredWallets.length,this.isFetchingRecommendedWallets=a.ApiController.state.isFetchingRecommendedWallets,this.unsubscribe.push(h.ConnectorController.subscribeKey("connectors",e=>this.connectors=e),a.ApiController.subscribeKey("count",e=>this.count=e),a.ApiController.subscribeKey("filteredWallets",e=>this.filteredCount=e.length),a.ApiController.subscribeKey("isFetchingRecommendedWallets",e=>this.isFetchingRecommendedWallets=e))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){let e=this.connectors.find(e=>"walletConnect"===e.id),{allWallets:t}=l.OptionsController.state;if(!e||"HIDE"===t||"ONLY_MOBILE"===t&&!n.j.isMobile())return null;let o=a.ApiController.state.featured.length,r=this.count+o,s=this.filteredCount>0?this.filteredCount:r<10?r:10*Math.floor(r/10),c=`${s}`;this.filteredCount>0?c=`${this.filteredCount}`:s<r&&(c=`${s}+`);let h=p.ConnectionController.hasAnyConnection(u.b.CONNECTOR_ID.WALLET_CONNECT);return(0,i.dy)`
      <wui-list-wallet
        name="Search Wallet"
        walletIcon="search"
        showAllWallets
        @click=${this.onAllWallets.bind(this)}
        tagLabel=${c}
        tagVariant="info"
        data-testid="all-wallets"
        tabIdx=${(0,d.o)(this.tabIdx)}
        .loading=${this.isFetchingRecommendedWallets}
        ?disabled=${h}
        size="sm"
      ></wui-list-wallet>
    `}onAllWallets(){g.X.sendEvent({type:"track",event:"CLICK_ALL_WALLETS"}),f.RouterController.push("AllWallets",{redirectView:f.RouterController.state.data?.redirectView})}};w([(0,r.Cb)()],m.prototype,"tabIdx",void 0),w([(0,r.SB)()],m.prototype,"connectors",void 0),w([(0,r.SB)()],m.prototype,"count",void 0),w([(0,r.SB)()],m.prototype,"filteredCount",void 0),w([(0,r.SB)()],m.prototype,"isFetchingRecommendedWallets",void 0),m=w([(0,c.Mo)("w3m-all-wallets-widget")],m);var b=o(22472),y=o(65733),v=o(63043),C=o(95221),x=o(54090),$=(0,c.iv)`
  :host {
    margin-top: ${({spacing:e})=>e["1"]};
  }
  wui-separator {
    margin: ${({spacing:e})=>e["3"]} calc(${({spacing:e})=>e["3"]} * -1)
      ${({spacing:e})=>e["2"]} calc(${({spacing:e})=>e["3"]} * -1);
    width: calc(100% + ${({spacing:e})=>e["3"]} * 2);
  }
`,R=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let E=class extends i.oi{constructor(){super(),this.unsubscribe=[],this.explorerWallets=a.ApiController.state.explorerWallets,this.connections=p.ConnectionController.state.connections,this.connectorImages=b.W.state.connectorImages,this.loadingTelegram=!1,this.unsubscribe.push(p.ConnectionController.subscribeKey("connections",e=>this.connections=e),b.W.subscribeKey("connectorImages",e=>this.connectorImages=e),a.ApiController.subscribeKey("explorerFilteredWallets",e=>{this.explorerWallets=e?.length?e:a.ApiController.state.explorerWallets}),a.ApiController.subscribeKey("explorerWallets",e=>{this.explorerWallets?.length||(this.explorerWallets=e)})),n.j.isTelegram()&&n.j.isIos()&&(this.loadingTelegram=!p.ConnectionController.state.wcUri,this.unsubscribe.push(p.ConnectionController.subscribeKey("wcUri",e=>this.loadingTelegram=!e)))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){return(0,i.dy)`
      <wui-flex flexDirection="column" gap="2"> ${this.connectorListTemplate()} </wui-flex>
    `}connectorListTemplate(){return y.C.connectorList().map((e,t)=>"connector"===e.kind?this.renderConnector(e,t):this.renderWallet(e,t))}getConnectorNamespaces(e){return"walletConnect"===e.subtype?[]:"multiChain"===e.subtype?e.connector.connectors?.map(e=>e.chain)||[]:[e.connector.chain]}renderConnector(e,t){let o,r;let n=e.connector,l=v.f.getConnectorImage(n)||this.connectorImages[n?.imageId??""],a=(this.connections.get(n.chain)??[]).some(e=>x.g.isLowerCaseMatch(e.connectorId,n.id));"walletConnect"===e.subtype?(o="qr code",r="accent"):"injected"===e.subtype||"announced"===e.subtype?(o=a?"connected":"installed",r=a?"info":"success"):(o=void 0,r=void 0);let s=p.ConnectionController.hasAnyConnection(u.b.CONNECTOR_ID.WALLET_CONNECT),c=("walletConnect"===e.subtype||"external"===e.subtype)&&s;return(0,i.dy)`
      <w3m-list-wallet
        displayIndex=${t}
        imageSrc=${(0,d.o)(l)}
        .installed=${!0}
        name=${n.name??"Unknown"}
        .tagVariant=${r}
        tagLabel=${(0,d.o)(o)}
        data-testid=${`wallet-selector-${n.id.toLowerCase()}`}
        size="sm"
        @click=${()=>this.onClickConnector(e)}
        tabIdx=${(0,d.o)(this.tabIdx)}
        ?disabled=${c}
        rdnsId=${(0,d.o)(n.explorerWallet?.rdns||void 0)}
        walletRank=${(0,d.o)(n.explorerWallet?.order)}
        .namespaces=${this.getConnectorNamespaces(e)}
      >
      </w3m-list-wallet>
    `}onClickConnector(e){let t=f.RouterController.state.data?.redirectView;if("walletConnect"===e.subtype){h.ConnectorController.setActiveConnector(e.connector),n.j.isMobile()?f.RouterController.push("AllWallets"):f.RouterController.push("ConnectingWalletConnect",{redirectView:t});return}if("multiChain"===e.subtype){h.ConnectorController.setActiveConnector(e.connector),f.RouterController.push("ConnectingMultiChain",{redirectView:t});return}if("injected"===e.subtype){h.ConnectorController.setActiveConnector(e.connector),f.RouterController.push("ConnectingExternal",{connector:e.connector,redirectView:t,wallet:e.connector.explorerWallet});return}if("announced"===e.subtype){if("walletConnect"===e.connector.id){n.j.isMobile()?f.RouterController.push("AllWallets"):f.RouterController.push("ConnectingWalletConnect",{redirectView:t});return}f.RouterController.push("ConnectingExternal",{connector:e.connector,redirectView:t,wallet:e.connector.explorerWallet});return}f.RouterController.push("ConnectingExternal",{connector:e.connector,redirectView:t})}renderWallet(e,t){let o=e.wallet,r=v.f.getWalletImage(o),n=p.ConnectionController.hasAnyConnection(u.b.CONNECTOR_ID.WALLET_CONNECT),l=this.loadingTelegram,a="recent"===e.subtype?"recent":void 0,s="recent"===e.subtype?"info":void 0;return(0,i.dy)`
      <w3m-list-wallet
        displayIndex=${t}
        imageSrc=${(0,d.o)(r)}
        name=${o.name??"Unknown"}
        @click=${()=>this.onClickWallet(e)}
        size="sm"
        data-testid=${`wallet-selector-${o.id}`}
        tabIdx=${(0,d.o)(this.tabIdx)}
        ?loading=${l}
        ?disabled=${n}
        rdnsId=${(0,d.o)(o.rdns||void 0)}
        walletRank=${(0,d.o)(o.order)}
        tagLabel=${(0,d.o)(a)}
        .tagVariant=${s}
      >
      </w3m-list-wallet>
    `}onClickWallet(e){let t=f.RouterController.state.data?.redirectView,o=C.R.state.activeChain;if("featured"===e.subtype){h.ConnectorController.selectWalletConnector(e.wallet);return}if("recent"===e.subtype){if(this.loadingTelegram)return;h.ConnectorController.selectWalletConnector(e.wallet);return}if("custom"===e.subtype){if(this.loadingTelegram)return;f.RouterController.push("ConnectingWalletConnect",{wallet:e.wallet,redirectView:t});return}if(this.loadingTelegram)return;let i=o?h.ConnectorController.getConnector({id:e.wallet.id,namespace:o}):void 0;i?f.RouterController.push("ConnectingExternal",{connector:i,redirectView:t}):f.RouterController.push("ConnectingWalletConnect",{wallet:e.wallet,redirectView:t})}};E.styles=$,R([(0,r.Cb)({type:Number})],E.prototype,"tabIdx",void 0),R([(0,r.SB)()],E.prototype,"explorerWallets",void 0),R([(0,r.SB)()],E.prototype,"connections",void 0),R([(0,r.SB)()],E.prototype,"connectorImages",void 0),R([(0,r.SB)()],E.prototype,"loadingTelegram",void 0),E=R([(0,c.Mo)("w3m-connector-list")],E);var k=o(42935),S=o(66909),T=o(49425),A=o(59388),I=o(31182),P=o(84249),B=o(57116);o(30706),o(18360);var L=o(11131),j=(0,L.iv)`
  :host {
    flex: 1;
    height: 100%;
  }

  button {
    width: 100%;
    height: 100%;
    display: inline-flex;
    align-items: center;
    padding: ${({spacing:e})=>e[1]} ${({spacing:e})=>e[2]};
    column-gap: ${({spacing:e})=>e[1]};
    color: ${({tokens:e})=>e.theme.textSecondary};
    border-radius: ${({borderRadius:e})=>e[20]};
    background-color: transparent;
    transition: background-color ${({durations:e})=>e.lg}
      ${({easings:e})=>e["ease-out-power-2"]};
    will-change: background-color;
  }

  /* -- Hover & Active states ----------------------------------------------------------- */
  button[data-active='true'] {
    color: ${({tokens:e})=>e.theme.textPrimary};
    background-color: ${({tokens:e})=>e.theme.foregroundTertiary};
  }

  button:hover:enabled:not([data-active='true']),
  button:active:enabled:not([data-active='true']) {
    wui-text,
    wui-icon {
      color: ${({tokens:e})=>e.theme.textPrimary};
    }
  }
`,O=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let M={lg:"lg-regular",md:"md-regular",sm:"sm-regular"},N={lg:"md",md:"sm",sm:"sm"},_=class extends i.oi{constructor(){super(...arguments),this.icon="mobile",this.size="md",this.label="",this.active=!1}render(){return(0,i.dy)`
      <button data-active=${this.active}>
        ${this.icon?(0,i.dy)`<wui-icon size=${N[this.size]} name=${this.icon}></wui-icon>`:""}
        <wui-text variant=${M[this.size]}> ${this.label} </wui-text>
      </button>
    `}};_.styles=[P.ET,P.ZM,j],O([(0,r.Cb)()],_.prototype,"icon",void 0),O([(0,r.Cb)()],_.prototype,"size",void 0),O([(0,r.Cb)()],_.prototype,"label",void 0),O([(0,r.Cb)({type:Boolean})],_.prototype,"active",void 0),_=O([(0,B.M)("wui-tab-item")],_);var W=(0,L.iv)`
  :host {
    display: inline-flex;
    align-items: center;
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    border-radius: ${({borderRadius:e})=>e[32]};
    padding: ${({spacing:e})=>e["01"]};
    box-sizing: border-box;
  }

  :host([data-size='sm']) {
    height: 26px;
  }

  :host([data-size='md']) {
    height: 36px;
  }
`,z=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let D=class extends i.oi{constructor(){super(...arguments),this.tabs=[],this.onTabChange=()=>null,this.size="md",this.activeTab=0}render(){return this.dataset.size=this.size,this.tabs.map((e,t)=>{let o=t===this.activeTab;return(0,i.dy)`
        <wui-tab-item
          @click=${()=>this.onTabClick(t)}
          icon=${e.icon}
          size=${this.size}
          label=${e.label}
          ?active=${o}
          data-active=${o}
          data-testid="tab-${e.label?.toLowerCase()}"
        ></wui-tab-item>
      `})}onTabClick(e){this.activeTab=e,this.onTabChange(e)}};D.styles=[P.ET,P.ZM,W],z([(0,r.Cb)({type:Array})],D.prototype,"tabs",void 0),z([(0,r.Cb)()],D.prototype,"onTabChange",void 0),z([(0,r.Cb)()],D.prototype,"size",void 0),z([(0,r.SB)()],D.prototype,"activeTab",void 0),D=z([(0,B.M)("wui-tabs")],D);var U=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let F=class extends i.oi{constructor(){super(...arguments),this.platformTabs=[],this.unsubscribe=[],this.platforms=[],this.onSelectPlatfrom=void 0}disconnectCallback(){this.unsubscribe.forEach(e=>e())}render(){let e=this.generateTabs();return(0,i.dy)`
      <wui-flex justifyContent="center" .padding=${["0","0","4","0"]}>
        <wui-tabs .tabs=${e} .onTabChange=${this.onTabChange.bind(this)}></wui-tabs>
      </wui-flex>
    `}generateTabs(){let e=this.platforms.map(e=>"browser"===e?{label:"Browser",icon:"extension",platform:"browser"}:"mobile"===e?{label:"Mobile",icon:"mobile",platform:"mobile"}:"qrcode"===e?{label:"Mobile",icon:"mobile",platform:"qrcode"}:"web"===e?{label:"Webapp",icon:"browser",platform:"web"}:"desktop"===e?{label:"Desktop",icon:"desktop",platform:"desktop"}:{label:"Browser",icon:"extension",platform:"unsupported"});return this.platformTabs=e.map(({platform:e})=>e),e}onTabChange(e){let t=this.platformTabs[e];t&&this.onSelectPlatfrom?.(t)}};U([(0,r.Cb)({type:Array})],F.prototype,"platforms",void 0),U([(0,r.Cb)()],F.prototype,"onSelectPlatfrom",void 0),F=U([(0,c.Mo)("w3m-connecting-header")],F);var q=o(52005);o(97585),o(4594),o(1736),o(51437);var H=(0,L.iv)`
  :host {
    display: block;
    width: 100px;
    height: 100px;
  }

  svg {
    width: 100px;
    height: 100px;
  }

  rect {
    fill: none;
    stroke: ${e=>e.colors.accent100};
    stroke-width: 3px;
    stroke-linecap: round;
    animation: dash 1s linear infinite;
  }

  @keyframes dash {
    to {
      stroke-dashoffset: 0px;
    }
  }
`,K=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let V=class extends i.oi{constructor(){super(...arguments),this.radius=36}render(){return this.svgLoaderTemplate()}svgLoaderTemplate(){let e=this.radius>50?50:this.radius,t=36-e;return(0,i.dy)`
      <svg viewBox="0 0 110 110" width="110" height="110">
        <rect
          x="2"
          y="2"
          width="106"
          height="106"
          rx=${e}
          stroke-dasharray="${116+t} ${245+t}"
          stroke-dashoffset=${360+1.75*t}
        />
      </svg>
    `}};V.styles=[P.ET,H],K([(0,r.Cb)({type:Number})],V.prototype,"radius",void 0),V=K([(0,B.M)("wui-loading-thumbnail")],V),o(44732),o(40511),o(5680),o(98629);var Y=(0,L.iv)`
  wui-flex {
    width: 100%;
    height: 52px;
    box-sizing: border-box;
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    border-radius: ${({borderRadius:e})=>e[5]};
    padding-left: ${({spacing:e})=>e[3]};
    padding-right: ${({spacing:e})=>e[3]};
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${({spacing:e})=>e[6]};
  }

  wui-text {
    color: ${({tokens:e})=>e.theme.textSecondary};
  }

  wui-icon {
    width: 12px;
    height: 12px;
  }
`,J=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let X=class extends i.oi{constructor(){super(...arguments),this.disabled=!1,this.label="",this.buttonLabel=""}render(){return(0,i.dy)`
      <wui-flex justifyContent="space-between" alignItems="center">
        <wui-text variant="lg-regular" color="inherit">${this.label}</wui-text>
        <wui-button variant="accent-secondary" size="sm">
          ${this.buttonLabel}
          <wui-icon name="chevronRight" color="inherit" size="inherit" slot="iconRight"></wui-icon>
        </wui-button>
      </wui-flex>
    `}};X.styles=[P.ET,P.ZM,Y],J([(0,r.Cb)({type:Boolean})],X.prototype,"disabled",void 0),J([(0,r.Cb)()],X.prototype,"label",void 0),J([(0,r.Cb)()],X.prototype,"buttonLabel",void 0),X=J([(0,B.M)("wui-cta-button")],X);var Q=(0,c.iv)`
  :host {
    display: block;
    padding: 0 ${({spacing:e})=>e["5"]} ${({spacing:e})=>e["5"]};
  }
`,G=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let Z=class extends i.oi{constructor(){super(...arguments),this.wallet=void 0}render(){if(!this.wallet)return this.style.display="none",null;let{name:e,app_store:t,play_store:o,chrome_store:r,homepage:l}=this.wallet,a=n.j.isMobile(),s=n.j.isIos(),d=n.j.isAndroid(),u=[t,o,l,r].filter(Boolean).length>1,h=c.Hg.getTruncateString({string:e,charsStart:12,charsEnd:0,truncate:"end"});return u&&!a?(0,i.dy)`
        <wui-cta-button
          label=${`Don't have ${h}?`}
          buttonLabel="Get"
          @click=${()=>f.RouterController.push("Downloads",{wallet:this.wallet})}
        ></wui-cta-button>
      `:!u&&l?(0,i.dy)`
        <wui-cta-button
          label=${`Don't have ${h}?`}
          buttonLabel="Get"
          @click=${this.onHomePage.bind(this)}
        ></wui-cta-button>
      `:t&&s?(0,i.dy)`
        <wui-cta-button
          label=${`Don't have ${h}?`}
          buttonLabel="Get"
          @click=${this.onAppStore.bind(this)}
        ></wui-cta-button>
      `:o&&d?(0,i.dy)`
        <wui-cta-button
          label=${`Don't have ${h}?`}
          buttonLabel="Get"
          @click=${this.onPlayStore.bind(this)}
        ></wui-cta-button>
      `:(this.style.display="none",null)}onAppStore(){this.wallet?.app_store&&n.j.openHref(this.wallet.app_store,"_blank")}onPlayStore(){this.wallet?.play_store&&n.j.openHref(this.wallet.play_store,"_blank")}onHomePage(){this.wallet?.homepage&&n.j.openHref(this.wallet.homepage,"_blank")}};Z.styles=[Q],G([(0,r.Cb)({type:Object})],Z.prototype,"wallet",void 0),Z=G([(0,c.Mo)("w3m-mobile-download-links")],Z);var ee=(0,c.iv)`
  @keyframes shake {
    0% {
      transform: translateX(0);
    }
    25% {
      transform: translateX(3px);
    }
    50% {
      transform: translateX(-3px);
    }
    75% {
      transform: translateX(3px);
    }
    100% {
      transform: translateX(0);
    }
  }

  wui-flex:first-child:not(:only-child) {
    position: relative;
  }

  wui-wallet-image {
    width: 56px;
    height: 56px;
  }

  wui-loading-thumbnail {
    position: absolute;
  }

  wui-icon-box {
    position: absolute;
    right: calc(${({spacing:e})=>e["1"]} * -1);
    bottom: calc(${({spacing:e})=>e["1"]} * -1);
    opacity: 0;
    transform: scale(0.5);
    transition-property: opacity, transform;
    transition-duration: ${({durations:e})=>e.lg};
    transition-timing-function: ${({easings:e})=>e["ease-out-power-2"]};
    will-change: opacity, transform;
  }

  wui-text[align='center'] {
    width: 100%;
    padding: 0px ${({spacing:e})=>e["4"]};
  }

  [data-error='true'] wui-icon-box {
    opacity: 1;
    transform: scale(1);
  }

  [data-error='true'] > wui-flex:first-child {
    animation: shake 250ms ${({easings:e})=>e["ease-out-power-2"]} both;
  }

  [data-retry='false'] wui-link {
    display: none;
  }

  [data-retry='true'] wui-link {
    display: block;
    opacity: 1;
  }

  w3m-mobile-download-links {
    padding: 0px;
    width: 100%;
  }
`,et=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};class eo extends i.oi{constructor(){super(),this.wallet=f.RouterController.state.data?.wallet,this.connector=f.RouterController.state.data?.connector,this.timeout=void 0,this.secondaryBtnIcon="refresh",this.onConnect=void 0,this.onRender=void 0,this.onAutoConnect=void 0,this.isWalletConnect=!0,this.unsubscribe=[],this.imageSrc=v.f.getConnectorImage(this.connector)??v.f.getWalletImage(this.wallet),this.name=this.wallet?.name??this.connector?.name??"Wallet",this.isRetrying=!1,this.uri=p.ConnectionController.state.wcUri,this.error=p.ConnectionController.state.wcError,this.ready=!1,this.showRetry=!1,this.label=void 0,this.secondaryBtnLabel="Try again",this.secondaryLabel="Accept connection request in the wallet",this.isLoading=!1,this.isMobile=!1,this.onRetry=void 0,this.unsubscribe.push(p.ConnectionController.subscribeKey("wcUri",e=>{this.uri=e,this.isRetrying&&this.onRetry&&(this.isRetrying=!1,this.onConnect?.())}),p.ConnectionController.subscribeKey("wcError",e=>this.error=e)),(n.j.isTelegram()||n.j.isSafari())&&n.j.isIos()&&p.ConnectionController.state.wcUri&&this.onConnect?.()}firstUpdated(){this.onAutoConnect?.(),this.showRetry=!this.onAutoConnect}disconnectedCallback(){this.unsubscribe.forEach(e=>e()),p.ConnectionController.setWcError(!1),clearTimeout(this.timeout)}render(){this.onRender?.(),this.onShowRetry();let e=this.error?"Connection can be declined if a previous request is still active":this.secondaryLabel,t="";return this.label?t=this.label:(t=`Continue in ${this.name}`,this.error&&(t="Connection declined")),(0,i.dy)`
      <wui-flex
        data-error=${(0,d.o)(this.error)}
        data-retry=${this.showRetry}
        flexDirection="column"
        alignItems="center"
        .padding=${["10","5","5","5"]}
        gap="6"
      >
        <wui-flex gap="2" justifyContent="center" alignItems="center">
          <wui-wallet-image size="lg" imageSrc=${(0,d.o)(this.imageSrc)}></wui-wallet-image>

          ${this.error?null:this.loaderTemplate()}

          <wui-icon-box
            color="error"
            icon="close"
            size="sm"
            border
            borderColor="wui-color-bg-125"
          ></wui-icon-box>
        </wui-flex>

        <wui-flex flexDirection="column" alignItems="center" gap="6"> <wui-flex
          flexDirection="column"
          alignItems="center"
          gap="2"
          .padding=${["2","0","0","0"]}
        >
          <wui-text align="center" variant="lg-medium" color=${this.error?"error":"primary"}>
            ${t}
          </wui-text>
          <wui-text align="center" variant="lg-regular" color="secondary">${e}</wui-text>
        </wui-flex>

        ${this.secondaryBtnLabel?(0,i.dy)`
                <wui-button
                  variant="neutral-secondary"
                  size="md"
                  ?disabled=${this.isRetrying||this.isLoading}
                  @click=${this.onTryAgain.bind(this)}
                  data-testid="w3m-connecting-widget-secondary-button"
                >
                  <wui-icon
                    color="inherit"
                    slot="iconLeft"
                    name=${this.secondaryBtnIcon}
                  ></wui-icon>
                  ${this.secondaryBtnLabel}
                </wui-button>
              `:null}
      </wui-flex>

      ${this.isWalletConnect?(0,i.dy)`
              <wui-flex .padding=${["0","5","5","5"]} justifyContent="center">
                <wui-link
                  @click=${this.onCopyUri}
                  variant="secondary"
                  icon="copy"
                  data-testid="wui-link-copy"
                >
                  Copy link
                </wui-link>
              </wui-flex>
            `:null}

      <w3m-mobile-download-links .wallet=${this.wallet}></w3m-mobile-download-links></wui-flex>
      </wui-flex>
    `}onShowRetry(){if(this.error&&!this.showRetry){this.showRetry=!0;let e=this.shadowRoot?.querySelector("wui-button");e?.animate([{opacity:0},{opacity:1}],{fill:"forwards",easing:"ease"})}}onTryAgain(){p.ConnectionController.setWcError(!1),this.onRetry?(this.isRetrying=!0,this.onRetry?.()):this.onConnect?.()}loaderTemplate(){let e=q.ThemeController.state.themeVariables["--w3m-border-radius-master"],t=e?parseInt(e.replace("px",""),10):4;return(0,i.dy)`<wui-loading-thumbnail radius=${9*t}></wui-loading-thumbnail>`}onCopyUri(){try{this.uri&&(n.j.copyToClopboard(this.uri),S.SnackController.showSuccess("Link copied"))}catch{S.SnackController.showError("Failed to copy")}}}eo.styles=ee,et([(0,r.SB)()],eo.prototype,"isRetrying",void 0),et([(0,r.SB)()],eo.prototype,"uri",void 0),et([(0,r.SB)()],eo.prototype,"error",void 0),et([(0,r.SB)()],eo.prototype,"ready",void 0),et([(0,r.SB)()],eo.prototype,"showRetry",void 0),et([(0,r.SB)()],eo.prototype,"label",void 0),et([(0,r.SB)()],eo.prototype,"secondaryBtnLabel",void 0),et([(0,r.SB)()],eo.prototype,"secondaryLabel",void 0),et([(0,r.SB)()],eo.prototype,"isLoading",void 0),et([(0,r.Cb)({type:Boolean})],eo.prototype,"isMobile",void 0),et([(0,r.Cb)()],eo.prototype,"onRetry",void 0);let ei=class extends eo{constructor(){if(super(),!this.wallet)throw Error("w3m-connecting-wc-browser: No wallet provided");this.onConnect=this.onConnectProxy.bind(this),this.onAutoConnect=this.onConnectProxy.bind(this),g.X.sendEvent({type:"track",event:"SELECT_WALLET",properties:{name:this.wallet.name,platform:"browser",displayIndex:this.wallet?.display_index,walletRank:this.wallet.order,view:f.RouterController.state.view}})}async onConnectProxy(){try{this.error=!1;let{connectors:e}=h.ConnectorController.state,t=e.find(e=>"ANNOUNCED"===e.type&&e.info?.rdns===this.wallet?.rdns||"INJECTED"===e.type||e.name===this.wallet?.name);if(t)await p.ConnectionController.connectExternal(t,t.chain);else throw Error("w3m-connecting-wc-browser: No connector found");T.I.close()}catch(e){e instanceof A.g&&e.originalName===k.jD.PROVIDER_RPC_ERROR_NAME.USER_REJECTED_REQUEST?g.X.sendEvent({type:"track",event:"USER_REJECTED",properties:{message:e.message}}):g.X.sendEvent({type:"track",event:"CONNECT_ERROR",properties:{message:e?.message??"Unknown"}}),this.error=!0}}};ei=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l}([(0,c.Mo)("w3m-connecting-wc-browser")],ei);let er=class extends eo{constructor(){if(super(),!this.wallet)throw Error("w3m-connecting-wc-desktop: No wallet provided");this.onConnect=this.onConnectProxy.bind(this),this.onRender=this.onRenderProxy.bind(this),g.X.sendEvent({type:"track",event:"SELECT_WALLET",properties:{name:this.wallet.name,platform:"desktop",displayIndex:this.wallet?.display_index,walletRank:this.wallet.order,view:f.RouterController.state.view}})}onRenderProxy(){!this.ready&&this.uri&&(this.ready=!0,this.onConnect?.())}onConnectProxy(){if(this.wallet?.desktop_link&&this.uri)try{this.error=!1;let{desktop_link:e,name:t}=this.wallet,{redirect:o,href:i}=n.j.formatNativeUrl(e,this.uri);p.ConnectionController.setWcLinking({name:t,href:i}),p.ConnectionController.setRecentWallet(this.wallet),n.j.openHref(o,"_blank")}catch{this.error=!0}}};er=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l}([(0,c.Mo)("w3m-connecting-wc-desktop")],er);var en=o(8789),el=o(97159),ea=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let es=class extends eo{constructor(){if(super(),this.btnLabelTimeout=void 0,this.redirectDeeplink=void 0,this.redirectUniversalLink=void 0,this.target=void 0,this.preferUniversalLinks=l.OptionsController.state.experimental_preferUniversalLinks,this.isLoading=!0,this.onConnect=()=>{en.f.onConnectMobile(this.wallet)},!this.wallet)throw Error("w3m-connecting-wc-mobile: No wallet provided");this.secondaryBtnLabel="Open",this.secondaryLabel=el.bq.CONNECT_LABELS.MOBILE,this.secondaryBtnIcon="externalLink",this.onHandleURI(),this.unsubscribe.push(p.ConnectionController.subscribeKey("wcUri",()=>{this.onHandleURI()})),g.X.sendEvent({type:"track",event:"SELECT_WALLET",properties:{name:this.wallet.name,platform:"mobile",displayIndex:this.wallet?.display_index,walletRank:this.wallet.order,view:f.RouterController.state.view}})}disconnectedCallback(){super.disconnectedCallback(),clearTimeout(this.btnLabelTimeout)}onHandleURI(){this.isLoading=!this.uri,!this.ready&&this.uri&&(this.ready=!0,this.onConnect?.())}onTryAgain(){p.ConnectionController.setWcError(!1),this.onConnect?.()}};ea([(0,r.SB)()],es.prototype,"redirectDeeplink",void 0),ea([(0,r.SB)()],es.prototype,"redirectUniversalLink",void 0),ea([(0,r.SB)()],es.prototype,"target",void 0),ea([(0,r.SB)()],es.prototype,"preferUniversalLinks",void 0),ea([(0,r.SB)()],es.prototype,"isLoading",void 0),es=ea([(0,c.Mo)("w3m-connecting-wc-mobile")],es),o(23805);var ec=o(35819);function ed(e,t,o){return e!==t&&(e-t<0?t-e:e-t)<=o+.1}let eu={generate({uri:e,size:t,logoSize:o,padding:r=8,dotColor:n="var(--apkt-colors-black)"}){let l=[],a=function(e,t){let o=Array.prototype.slice.call(ec.create(e,{errorCorrectionLevel:"Q"}).modules.data,0),i=Math.sqrt(o.length);return o.reduce((e,t,o)=>(o%i==0?e.push([t]):e[e.length-1].push(t))&&e,[])}(e,0),s=(t-2*r)/a.length,c=[{x:0,y:0},{x:1,y:0},{x:0,y:1}];c.forEach(({x:e,y:t})=>{let o=(a.length-7)*s*e+r,d=(a.length-7)*s*t+r;for(let e=0;e<c.length;e+=1){let t=s*(7-2*e);l.push((0,i.YP)`
            <rect
              fill=${2===e?"var(--apkt-colors-black)":"var(--apkt-colors-white)"}
              width=${0===e?t-10:t}
              rx= ${0===e?(t-10)*.45:.45*t}
              ry= ${0===e?(t-10)*.45:.45*t}
              stroke=${n}
              stroke-width=${0===e?10:0}
              height=${0===e?t-10:t}
              x= ${0===e?d+s*e+5:d+s*e}
              y= ${0===e?o+s*e+5:o+s*e}
            />
          `)}});let d=Math.floor((o+25)/s),u=a.length/2-d/2,h=a.length/2+d/2-1,p=[];a.forEach((e,t)=>{e.forEach((e,o)=>{!a[t][o]||t<7&&o<7||t>a.length-8&&o<7||t<7&&o>a.length-8||t>u&&t<h&&o>u&&o<h||p.push([t*s+s/2+r,o*s+s/2+r])})});let g={};return p.forEach(([e,t])=>{g[e]?g[e]?.push(t):g[e]=[t]}),Object.entries(g).map(([e,t])=>{let o=t.filter(e=>t.every(t=>!ed(e,t,s)));return[Number(e),o]}).forEach(([e,t])=>{t.forEach(t=>{l.push((0,i.YP)`<circle cx=${e} cy=${t} fill=${n} r=${s/2.5} />`)})}),Object.entries(g).filter(([e,t])=>t.length>1).map(([e,t])=>{let o=t.filter(e=>t.some(t=>ed(e,t,s)));return[Number(e),o]}).map(([e,t])=>{t.sort((e,t)=>e<t?-1:1);let o=[];for(let e of t){let t=o.find(t=>t.some(t=>ed(e,t,s)));t?t.push(e):o.push([e])}return[e,o.map(e=>[e[0],e[e.length-1]])]}).forEach(([e,t])=>{t.forEach(([t,o])=>{l.push((0,i.YP)`
              <line
                x1=${e}
                x2=${e}
                y1=${t}
                y2=${o}
                stroke=${n}
                stroke-width=${s/1.25}
                stroke-linecap="round"
              />
            `)})}),l}};var eh=(0,L.iv)`
  :host {
    position: relative;
    user-select: none;
    display: block;
    overflow: hidden;
    aspect-ratio: 1 / 1;
    width: 100%;
    height: 100%;
    background-color: ${({colors:e})=>e.white};
    border: 1px solid ${({tokens:e})=>e.theme.borderPrimary};
  }

  :host {
    border-radius: ${({borderRadius:e})=>e[4]};
    display: flex;
    align-items: center;
    justify-content: center;
  }

  :host([data-clear='true']) > wui-icon {
    display: none;
  }

  svg:first-child,
  wui-image,
  wui-icon {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translateY(-50%) translateX(-50%);
    background-color: ${({tokens:e})=>e.theme.backgroundPrimary};
    box-shadow: inset 0 0 0 4px ${({tokens:e})=>e.theme.backgroundPrimary};
    border-radius: ${({borderRadius:e})=>e[6]};
  }

  wui-image {
    width: 25%;
    height: 25%;
    border-radius: ${({borderRadius:e})=>e[2]};
  }

  wui-icon {
    width: 100%;
    height: 100%;
    color: #3396ff !important;
    transform: translateY(-50%) translateX(-50%) scale(0.25);
  }

  wui-icon > svg {
    width: inherit;
    height: inherit;
  }
`,ep=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let eg=class extends i.oi{constructor(){super(...arguments),this.uri="",this.size=500,this.theme="dark",this.imageSrc=void 0,this.alt=void 0,this.arenaClear=void 0,this.farcaster=void 0}render(){return this.dataset.theme=this.theme,this.dataset.clear=String(this.arenaClear),(0,i.dy)`<wui-flex
      alignItems="center"
      justifyContent="center"
      class="wui-qr-code"
      direction="column"
      gap="4"
      width="100%"
      style="height: 100%"
    >
      ${this.templateVisual()} ${this.templateSvg()}
    </wui-flex>`}templateSvg(){return(0,i.YP)`
      <svg viewBox="0 0 ${this.size} ${this.size}" width="100%" height="100%">
        ${eu.generate({uri:this.uri,size:this.size,logoSize:this.arenaClear?0:this.size/4})}
      </svg>
    `}templateVisual(){return this.imageSrc?(0,i.dy)`<wui-image src=${this.imageSrc} alt=${this.alt??"logo"}></wui-image>`:this.farcaster?(0,i.dy)`<wui-icon
        class="farcaster"
        size="inherit"
        color="inherit"
        name="farcaster"
      ></wui-icon>`:(0,i.dy)`<wui-icon size="inherit" color="inherit" name="walletConnect"></wui-icon>`}};eg.styles=[P.ET,eh],ep([(0,r.Cb)()],eg.prototype,"uri",void 0),ep([(0,r.Cb)({type:Number})],eg.prototype,"size",void 0),ep([(0,r.Cb)()],eg.prototype,"theme",void 0),ep([(0,r.Cb)()],eg.prototype,"imageSrc",void 0),ep([(0,r.Cb)()],eg.prototype,"alt",void 0),ep([(0,r.Cb)({type:Boolean})],eg.prototype,"arenaClear",void 0),ep([(0,r.Cb)({type:Boolean})],eg.prototype,"farcaster",void 0),eg=ep([(0,B.M)("wui-qr-code")],eg),o(80843),o(63957);var ef=(0,c.iv)`
  wui-shimmer {
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: ${({borderRadius:e})=>e[4]};
  }

  wui-qr-code {
    opacity: 0;
    animation-duration: ${({durations:e})=>e.xl};
    animation-timing-function: ${({easings:e})=>e["ease-out-power-2"]};
    animation-name: fade-in;
    animation-fill-mode: forwards;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
`,ew=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let em=class extends eo{constructor(){super(),this.basic=!1}firstUpdated(){this.basic||g.X.sendEvent({type:"track",event:"SELECT_WALLET",properties:{name:this.wallet?.name??"WalletConnect",platform:"qrcode",displayIndex:this.wallet?.display_index,walletRank:this.wallet?.order,view:f.RouterController.state.view}})}disconnectedCallback(){super.disconnectedCallback(),this.unsubscribe?.forEach(e=>e())}render(){return this.onRenderProxy(),(0,i.dy)`
      <wui-flex
        flexDirection="column"
        alignItems="center"
        .padding=${["0","5","5","5"]}
        gap="5"
      >
        <wui-shimmer width="100%"> ${this.qrCodeTemplate()} </wui-shimmer>
        <wui-text variant="lg-medium" color="primary"> Scan this QR Code with your phone </wui-text>
        ${this.copyTemplate()}
      </wui-flex>
      <w3m-mobile-download-links .wallet=${this.wallet}></w3m-mobile-download-links>
    `}onRenderProxy(){!this.ready&&this.uri&&(this.ready=!0)}qrCodeTemplate(){if(!this.uri||!this.ready)return null;let e=this.wallet?this.wallet.name:void 0;p.ConnectionController.setWcLinking(void 0),p.ConnectionController.setRecentWallet(this.wallet);let t=q.ThemeController.state.themeVariables["--apkt-qr-color"]??q.ThemeController.state.themeVariables["--w3m-qr-color"];return(0,i.dy)` <wui-qr-code
      theme=${q.ThemeController.state.themeMode}
      uri=${this.uri}
      imageSrc=${(0,d.o)(v.f.getWalletImage(this.wallet))}
      color=${(0,d.o)(t)}
      alt=${(0,d.o)(e)}
      data-testid="wui-qr-code"
    ></wui-qr-code>`}copyTemplate(){let e=!this.uri||!this.ready;return(0,i.dy)`<wui-button
      .disabled=${e}
      @click=${this.onCopyUri}
      variant="neutral-secondary"
      size="sm"
      data-testid="copy-wc2-uri"
    >
      Copy link
      <wui-icon size="sm" color="inherit" name="copy" slot="iconRight"></wui-icon>
    </wui-button>`}};em.styles=ef,ew([(0,r.Cb)({type:Boolean})],em.prototype,"basic",void 0),em=ew([(0,c.Mo)("w3m-connecting-wc-qrcode")],em);let eb=class extends i.oi{constructor(){if(super(),this.wallet=f.RouterController.state.data?.wallet,!this.wallet)throw Error("w3m-connecting-wc-unsupported: No wallet provided");g.X.sendEvent({type:"track",event:"SELECT_WALLET",properties:{name:this.wallet.name,platform:"browser",displayIndex:this.wallet?.display_index,walletRank:this.wallet?.order,view:f.RouterController.state.view}})}render(){return(0,i.dy)`
      <wui-flex
        flexDirection="column"
        alignItems="center"
        .padding=${["10","5","5","5"]}
        gap="5"
      >
        <wui-wallet-image
          size="lg"
          imageSrc=${(0,d.o)(v.f.getWalletImage(this.wallet))}
        ></wui-wallet-image>

        <wui-text variant="md-regular" color="primary">Not Detected</wui-text>
      </wui-flex>

      <w3m-mobile-download-links .wallet=${this.wallet}></w3m-mobile-download-links>
    `}};eb=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l}([(0,c.Mo)("w3m-connecting-wc-unsupported")],eb);var ey=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let ev=class extends eo{constructor(){if(super(),this.isLoading=!0,!this.wallet)throw Error("w3m-connecting-wc-web: No wallet provided");this.onConnect=this.onConnectProxy.bind(this),this.secondaryBtnLabel="Open",this.secondaryLabel=el.bq.CONNECT_LABELS.MOBILE,this.secondaryBtnIcon="externalLink",this.updateLoadingState(),this.unsubscribe.push(p.ConnectionController.subscribeKey("wcUri",()=>{this.updateLoadingState()})),g.X.sendEvent({type:"track",event:"SELECT_WALLET",properties:{name:this.wallet.name,platform:"web",displayIndex:this.wallet?.display_index,walletRank:this.wallet?.order,view:f.RouterController.state.view}})}updateLoadingState(){this.isLoading=!this.uri}onConnectProxy(){if(this.wallet?.webapp_link&&this.uri)try{this.error=!1;let{webapp_link:e,name:t}=this.wallet,{redirect:o,href:i}=n.j.formatUniversalUrl(e,this.uri);p.ConnectionController.setWcLinking({name:t,href:i}),p.ConnectionController.setRecentWallet(this.wallet),n.j.openHref(o,"_blank")}catch{this.error=!0}}};ey([(0,r.SB)()],ev.prototype,"isLoading",void 0),ev=ey([(0,c.Mo)("w3m-connecting-wc-web")],ev);var eC=(0,c.iv)`
  :host([data-mobile-fullscreen='true']) {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  :host([data-mobile-fullscreen='true']) wui-ux-by-reown {
    margin-top: auto;
  }
`,ex=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let e$=class extends i.oi{constructor(){super(),this.wallet=f.RouterController.state.data?.wallet,this.unsubscribe=[],this.platform=void 0,this.platforms=[],this.isSiwxEnabled=!!l.OptionsController.state.siwx,this.remoteFeatures=l.OptionsController.state.remoteFeatures,this.displayBranding=!0,this.basic=!1,this.determinePlatforms(),this.initializeConnection(),this.unsubscribe.push(l.OptionsController.subscribeKey("remoteFeatures",e=>this.remoteFeatures=e))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){return l.OptionsController.state.enableMobileFullScreen&&this.setAttribute("data-mobile-fullscreen","true"),(0,i.dy)`
      ${this.headerTemplate()}
      <div class="platform-container">${this.platformTemplate()}</div>
      ${this.reownBrandingTemplate()}
    `}reownBrandingTemplate(){return this.remoteFeatures?.reownBranding&&this.displayBranding?(0,i.dy)`<wui-ux-by-reown></wui-ux-by-reown>`:null}async initializeConnection(e=!1){if("browser"!==this.platform&&(!l.OptionsController.state.manualWCControl||e))try{let{wcPairingExpiry:t,status:o}=p.ConnectionController.state,{redirectView:i}=f.RouterController.state.data??{};if(e||l.OptionsController.state.enableEmbedded||n.j.isPairingExpired(t)||"connecting"===o){let e=p.ConnectionController.getConnections(C.R.state.activeChain),t=this.remoteFeatures?.multiWallet,o=e.length>0;await p.ConnectionController.connectWalletConnect({cache:"never"}),this.isSiwxEnabled||(o&&t?(f.RouterController.replace("ProfileWallets"),S.SnackController.showSuccess("New Wallet Added")):i?f.RouterController.replace(i):T.I.close())}}catch(e){if(e instanceof Error&&e.message.includes("An error occurred when attempting to switch chain")&&!l.OptionsController.state.enableNetworkSwitch&&C.R.state.activeChain){C.R.setActiveCaipNetwork(I.f.getUnsupportedNetwork(`${C.R.state.activeChain}:${C.R.state.activeCaipNetwork?.id}`)),C.R.showUnsupportedChainUI();return}e instanceof A.g&&e.originalName===k.jD.PROVIDER_RPC_ERROR_NAME.USER_REJECTED_REQUEST?g.X.sendEvent({type:"track",event:"USER_REJECTED",properties:{message:e.message}}):g.X.sendEvent({type:"track",event:"CONNECT_ERROR",properties:{message:e?.message??"Unknown"}}),p.ConnectionController.setWcError(!0),S.SnackController.showError(e.message??"Connection error"),p.ConnectionController.resetWcConnection(),f.RouterController.goBack()}}determinePlatforms(){if(!this.wallet){this.platforms.push("qrcode"),this.platform="qrcode";return}if(this.platform)return;let{mobile_link:e,desktop_link:t,webapp_link:o,injected:i,rdns:r}=this.wallet,a=i?.map(({injected_id:e})=>e).filter(Boolean),s=[...r?[r]:a??[]],c=!l.OptionsController.state.isUniversalProvider&&s.length,d=p.ConnectionController.checkInstalled(s),u=c&&d,h=t&&!n.j.isMobile();u&&!C.R.state.noAdapters&&this.platforms.push("browser"),e&&this.platforms.push(n.j.isMobile()?"mobile":"qrcode"),o&&this.platforms.push("web"),h&&this.platforms.push("desktop"),u||!c||C.R.state.noAdapters||this.platforms.push("unsupported"),this.platform=this.platforms[0]}platformTemplate(){switch(this.platform){case"browser":return(0,i.dy)`<w3m-connecting-wc-browser></w3m-connecting-wc-browser>`;case"web":return(0,i.dy)`<w3m-connecting-wc-web></w3m-connecting-wc-web>`;case"desktop":return(0,i.dy)`
          <w3m-connecting-wc-desktop .onRetry=${()=>this.initializeConnection(!0)}>
          </w3m-connecting-wc-desktop>
        `;case"mobile":return(0,i.dy)`
          <w3m-connecting-wc-mobile isMobile .onRetry=${()=>this.initializeConnection(!0)}>
          </w3m-connecting-wc-mobile>
        `;case"qrcode":return(0,i.dy)`<w3m-connecting-wc-qrcode ?basic=${this.basic}></w3m-connecting-wc-qrcode>`;default:return(0,i.dy)`<w3m-connecting-wc-unsupported></w3m-connecting-wc-unsupported>`}}headerTemplate(){return this.platforms.length>1?(0,i.dy)`
      <w3m-connecting-header
        .platforms=${this.platforms}
        .onSelectPlatfrom=${this.onSelectPlatform.bind(this)}
      >
      </w3m-connecting-header>
    `:null}async onSelectPlatform(e){let t=this.shadowRoot?.querySelector("div");t&&(await t.animate([{opacity:1},{opacity:0}],{duration:200,fill:"forwards",easing:"ease"}).finished,this.platform=e,t.animate([{opacity:0},{opacity:1}],{duration:200,fill:"forwards",easing:"ease"}))}};e$.styles=eC,ex([(0,r.SB)()],e$.prototype,"platform",void 0),ex([(0,r.SB)()],e$.prototype,"platforms",void 0),ex([(0,r.SB)()],e$.prototype,"isSiwxEnabled",void 0),ex([(0,r.SB)()],e$.prototype,"remoteFeatures",void 0),ex([(0,r.Cb)({type:Boolean})],e$.prototype,"displayBranding",void 0),ex([(0,r.Cb)({type:Boolean})],e$.prototype,"basic",void 0),e$=ex([(0,c.Mo)("w3m-connecting-wc-view")],e$);var eR=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let eE=class extends i.oi{constructor(){super(),this.unsubscribe=[],this.isMobile=n.j.isMobile(),this.remoteFeatures=l.OptionsController.state.remoteFeatures,this.unsubscribe.push(l.OptionsController.subscribeKey("remoteFeatures",e=>this.remoteFeatures=e))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){if(this.isMobile){let{featured:e,recommended:t}=a.ApiController.state,{customWallets:o}=l.OptionsController.state,r=s.M.getRecentWallets(),n=e.length||t.length||o?.length||r.length;return(0,i.dy)`<wui-flex flexDirection="column" gap="2" .margin=${["1","3","3","3"]}>
        ${n?(0,i.dy)`<w3m-connector-list></w3m-connector-list>`:null}
        <w3m-all-wallets-widget></w3m-all-wallets-widget>
      </wui-flex>`}return(0,i.dy)`<wui-flex flexDirection="column" .padding=${["0","0","4","0"]}>
        <w3m-connecting-wc-view ?basic=${!0} .displayBranding=${!1}></w3m-connecting-wc-view>
        <wui-flex flexDirection="column" .padding=${["0","3","0","3"]}>
          <w3m-all-wallets-widget></w3m-all-wallets-widget>
        </wui-flex>
      </wui-flex>
      ${this.reownBrandingTemplate()} `}reownBrandingTemplate(){return this.remoteFeatures?.reownBranding?(0,i.dy)` <wui-flex flexDirection="column" .padding=${["1","0","1","0"]}>
      <wui-ux-by-reown></wui-ux-by-reown>
    </wui-flex>`:null}};eR([(0,r.SB)()],eE.prototype,"isMobile",void 0),eR([(0,r.SB)()],eE.prototype,"remoteFeatures",void 0),eE=eR([(0,c.Mo)("w3m-connecting-wc-basic-view")],eE);var ek=o(81997);let{I:eS}=ek._$LH,eT=e=>void 0===e.strings;var eA=o(42216);let eI=(e,t)=>{let o=e._$AN;if(void 0===o)return!1;for(let e of o)e._$AO?.(t,!1),eI(e,t);return!0},eP=e=>{let t,o;do{if(void 0===(t=e._$AM))break;(o=t._$AN).delete(e),e=t}while(0===o?.size)},eB=e=>{for(let t;t=e._$AM;e=t){let o=t._$AN;if(void 0===o)t._$AN=o=new Set;else if(o.has(e))break;o.add(e),eO(t)}};function eL(e){void 0!==this._$AN?(eP(this),this._$AM=e,eB(this)):this._$AM=e}function ej(e,t=!1,o=0){let i=this._$AH,r=this._$AN;if(void 0!==r&&0!==r.size){if(t){if(Array.isArray(i))for(let e=o;e<i.length;e++)eI(i[e],!1),eP(i[e]);else null!=i&&(eI(i,!1),eP(i))}else eI(this,e)}}let eO=e=>{e.type==eA.pX.CHILD&&(e._$AP??=ej,e._$AQ??=eL)};class eM extends eA.Xe{constructor(){super(...arguments),this._$AN=void 0}_$AT(e,t,o){super._$AT(e,t,o),eB(this),this.isConnected=e._$AU}_$AO(e,t=!0){e!==this.isConnected&&(this.isConnected=e,e?this.reconnected?.():this.disconnected?.()),t&&(eI(this,e),eP(this))}setValue(e){if(eT(this._$Ct))this._$Ct._$AI(e,this);else{let t=[...this._$Ct._$AH];t[this._$Ci]=e,this._$Ct._$AI(t,this,0)}}disconnected(){}reconnected(){}}let eN=()=>new e_;class e_{}let eW=new WeakMap,ez=(0,eA.XM)(class extends eM{render(e){return ek.Ld}update(e,[t]){let o=t!==this.G;return o&&void 0!==this.G&&this.rt(void 0),(o||this.lt!==this.ct)&&(this.G=t,this.ht=e.options?.host,this.rt(this.ct=e.element)),ek.Ld}rt(e){if(this.isConnected||(e=void 0),"function"==typeof this.G){let t=this.ht??globalThis,o=eW.get(t);void 0===o&&(o=new WeakMap,eW.set(t,o)),void 0!==o.get(this.G)&&this.G.call(this.ht,void 0),o.set(this.G,e),void 0!==e&&this.G.call(this.ht,e)}else this.G.value=e}get lt(){return"function"==typeof this.G?eW.get(this.ht??globalThis)?.get(this.G):this.G?.value}disconnected(){this.lt===this.ct&&this.rt(void 0)}reconnected(){this.rt(this.ct)}});var eD=(0,L.iv)`
  :host {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  label {
    position: relative;
    display: inline-block;
    user-select: none;
    transition:
      background-color ${({durations:e})=>e.lg}
        ${({easings:e})=>e["ease-out-power-2"]},
      color ${({durations:e})=>e.lg} ${({easings:e})=>e["ease-out-power-2"]},
      border ${({durations:e})=>e.lg} ${({easings:e})=>e["ease-out-power-2"]},
      box-shadow ${({durations:e})=>e.lg}
        ${({easings:e})=>e["ease-out-power-2"]},
      width ${({durations:e})=>e.lg} ${({easings:e})=>e["ease-out-power-2"]},
      height ${({durations:e})=>e.lg} ${({easings:e})=>e["ease-out-power-2"]},
      transform ${({durations:e})=>e.lg}
        ${({easings:e})=>e["ease-out-power-2"]},
      opacity ${({durations:e})=>e.lg} ${({easings:e})=>e["ease-out-power-2"]};
    will-change: background-color, color, border, box-shadow, width, height, transform, opacity;
  }

  input {
    width: 0;
    height: 0;
    opacity: 0;
  }

  span {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: ${({colors:e})=>e.neutrals300};
    border-radius: ${({borderRadius:e})=>e.round};
    border: 1px solid transparent;
    will-change: border;
    transition:
      background-color ${({durations:e})=>e.lg}
        ${({easings:e})=>e["ease-out-power-2"]},
      color ${({durations:e})=>e.lg} ${({easings:e})=>e["ease-out-power-2"]},
      border ${({durations:e})=>e.lg} ${({easings:e})=>e["ease-out-power-2"]},
      box-shadow ${({durations:e})=>e.lg}
        ${({easings:e})=>e["ease-out-power-2"]},
      width ${({durations:e})=>e.lg} ${({easings:e})=>e["ease-out-power-2"]},
      height ${({durations:e})=>e.lg} ${({easings:e})=>e["ease-out-power-2"]},
      transform ${({durations:e})=>e.lg}
        ${({easings:e})=>e["ease-out-power-2"]},
      opacity ${({durations:e})=>e.lg} ${({easings:e})=>e["ease-out-power-2"]};
    will-change: background-color, color, border, box-shadow, width, height, transform, opacity;
  }

  span:before {
    content: '';
    position: absolute;
    background-color: ${({colors:e})=>e.white};
    border-radius: 50%;
  }

  /* -- Sizes --------------------------------------------------------- */
  label[data-size='lg'] {
    width: 48px;
    height: 32px;
  }

  label[data-size='md'] {
    width: 40px;
    height: 28px;
  }

  label[data-size='sm'] {
    width: 32px;
    height: 22px;
  }

  label[data-size='lg'] > span:before {
    height: 24px;
    width: 24px;
    left: 4px;
    top: 3px;
  }

  label[data-size='md'] > span:before {
    height: 20px;
    width: 20px;
    left: 4px;
    top: 3px;
  }

  label[data-size='sm'] > span:before {
    height: 16px;
    width: 16px;
    left: 3px;
    top: 2px;
  }

  /* -- Focus states --------------------------------------------------- */
  input:focus-visible:not(:checked) + span,
  input:focus:not(:checked) + span {
    border: 1px solid ${({tokens:e})=>e.core.iconAccentPrimary};
    background-color: ${({tokens:e})=>e.theme.textTertiary};
    box-shadow: 0px 0px 0px 4px rgba(9, 136, 240, 0.2);
  }

  input:focus-visible:checked + span,
  input:focus:checked + span {
    border: 1px solid ${({tokens:e})=>e.core.iconAccentPrimary};
    box-shadow: 0px 0px 0px 4px rgba(9, 136, 240, 0.2);
  }

  /* -- Checked states --------------------------------------------------- */
  input:checked + span {
    background-color: ${({tokens:e})=>e.core.iconAccentPrimary};
  }

  label[data-size='lg'] > input:checked + span:before {
    transform: translateX(calc(100% - 9px));
  }

  label[data-size='md'] > input:checked + span:before {
    transform: translateX(calc(100% - 9px));
  }

  label[data-size='sm'] > input:checked + span:before {
    transform: translateX(calc(100% - 7px));
  }

  /* -- Hover states ------------------------------------------------------- */
  label:hover > input:not(:checked):not(:disabled) + span {
    background-color: ${({colors:e})=>e.neutrals400};
  }

  label:hover > input:checked:not(:disabled) + span {
    background-color: ${({colors:e})=>e.accent080};
  }

  /* -- Disabled state --------------------------------------------------- */
  label:has(input:disabled) {
    pointer-events: none;
    user-select: none;
  }

  input:not(:checked):disabled + span {
    background-color: ${({colors:e})=>e.neutrals700};
  }

  input:checked:disabled + span {
    background-color: ${({colors:e})=>e.neutrals700};
  }

  input:not(:checked):disabled + span::before {
    background-color: ${({colors:e})=>e.neutrals400};
  }

  input:checked:disabled + span::before {
    background-color: ${({tokens:e})=>e.theme.textTertiary};
  }
`,eU=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let eF=class extends i.oi{constructor(){super(...arguments),this.inputElementRef=eN(),this.checked=!1,this.disabled=!1,this.size="md"}render(){return(0,i.dy)`
      <label data-size=${this.size}>
        <input
          ${ez(this.inputElementRef)}
          type="checkbox"
          ?checked=${this.checked}
          ?disabled=${this.disabled}
          @change=${this.dispatchChangeEvent.bind(this)}
        />
        <span></span>
      </label>
    `}dispatchChangeEvent(){this.dispatchEvent(new CustomEvent("switchChange",{detail:this.inputElementRef.value?.checked,bubbles:!0,composed:!0}))}};eF.styles=[P.ET,P.ZM,eD],eU([(0,r.Cb)({type:Boolean})],eF.prototype,"checked",void 0),eU([(0,r.Cb)({type:Boolean})],eF.prototype,"disabled",void 0),eU([(0,r.Cb)()],eF.prototype,"size",void 0),eF=eU([(0,B.M)("wui-toggle")],eF);var eq=(0,L.iv)`
  :host {
    height: auto;
  }

  :host > wui-flex {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    column-gap: ${({spacing:e})=>e["2"]};
    padding: ${({spacing:e})=>e["2"]} ${({spacing:e})=>e["3"]};
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    border-radius: ${({borderRadius:e})=>e["4"]};
    box-shadow: inset 0 0 0 1px ${({tokens:e})=>e.theme.foregroundPrimary};
    transition: background-color ${({durations:e})=>e.lg}
      ${({easings:e})=>e["ease-out-power-2"]};
    will-change: background-color;
    cursor: pointer;
  }

  wui-switch {
    pointer-events: none;
  }
`,eH=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let eK=class extends i.oi{constructor(){super(...arguments),this.checked=!1}render(){return(0,i.dy)`
      <wui-flex>
        <wui-icon size="xl" name="walletConnectBrown"></wui-icon>
        <wui-toggle
          ?checked=${this.checked}
          size="sm"
          @switchChange=${this.handleToggleChange.bind(this)}
        ></wui-toggle>
      </wui-flex>
    `}handleToggleChange(e){e.stopPropagation(),this.checked=e.detail,this.dispatchSwitchEvent()}dispatchSwitchEvent(){this.dispatchEvent(new CustomEvent("certifiedSwitchChange",{detail:this.checked,bubbles:!0,composed:!0}))}};eK.styles=[P.ET,P.ZM,eq],eH([(0,r.Cb)({type:Boolean})],eK.prototype,"checked",void 0),eK=eH([(0,B.M)("wui-certified-switch")],eK);var eV=(0,L.iv)`
  :host {
    position: relative;
    width: 100%;
    display: inline-flex;
    flex-direction: column;
    gap: ${({spacing:e})=>e[3]};
    color: ${({tokens:e})=>e.theme.textPrimary};
    caret-color: ${({tokens:e})=>e.core.textAccentPrimary};
  }

  .wui-input-text-container {
    position: relative;
    display: flex;
  }

  input {
    width: 100%;
    border-radius: ${({borderRadius:e})=>e[4]};
    color: inherit;
    background: transparent;
    border: 1px solid ${({tokens:e})=>e.theme.borderPrimary};
    caret-color: ${({tokens:e})=>e.core.textAccentPrimary};
    padding: ${({spacing:e})=>e[3]} ${({spacing:e})=>e[3]}
      ${({spacing:e})=>e[3]} ${({spacing:e})=>e[10]};
    font-size: ${({textSize:e})=>e.large};
    line-height: ${({typography:e})=>e["lg-regular"].lineHeight};
    letter-spacing: ${({typography:e})=>e["lg-regular"].letterSpacing};
    font-weight: ${({fontWeight:e})=>e.regular};
    font-family: ${({fontFamily:e})=>e.regular};
  }

  input[data-size='lg'] {
    padding: ${({spacing:e})=>e[4]} ${({spacing:e})=>e[3]}
      ${({spacing:e})=>e[4]} ${({spacing:e})=>e[10]};
  }

  @media (hover: hover) and (pointer: fine) {
    input:hover:enabled {
      border: 1px solid ${({tokens:e})=>e.theme.borderSecondary};
    }
  }

  input:disabled {
    cursor: unset;
    border: 1px solid ${({tokens:e})=>e.theme.borderPrimary};
  }

  input::placeholder {
    color: ${({tokens:e})=>e.theme.textSecondary};
  }

  input:focus:enabled {
    border: 1px solid ${({tokens:e})=>e.theme.borderSecondary};
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    -webkit-box-shadow: 0px 0px 0px 4px ${({tokens:e})=>e.core.foregroundAccent040};
    -moz-box-shadow: 0px 0px 0px 4px ${({tokens:e})=>e.core.foregroundAccent040};
    box-shadow: 0px 0px 0px 4px ${({tokens:e})=>e.core.foregroundAccent040};
  }

  div.wui-input-text-container:has(input:disabled) {
    opacity: 0.5;
  }

  wui-icon.wui-input-text-left-icon {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    left: ${({spacing:e})=>e[4]};
    color: ${({tokens:e})=>e.theme.iconDefault};
  }

  button.wui-input-text-submit-button {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    right: ${({spacing:e})=>e[3]};
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    border-radius: ${({borderRadius:e})=>e[2]};
    color: ${({tokens:e})=>e.core.textAccentPrimary};
  }

  button.wui-input-text-submit-button:disabled {
    opacity: 1;
  }

  button.wui-input-text-submit-button.loading wui-icon {
    animation: spin 1s linear infinite;
  }

  button.wui-input-text-submit-button:hover {
    background: ${({tokens:e})=>e.core.foregroundAccent010};
  }

  input:has(+ .wui-input-text-submit-button) {
    padding-right: ${({spacing:e})=>e[12]};
  }

  input[type='number'] {
    -moz-appearance: textfield;
  }

  input[type='search']::-webkit-search-decoration,
  input[type='search']::-webkit-search-cancel-button,
  input[type='search']::-webkit-search-results-button,
  input[type='search']::-webkit-search-results-decoration {
    -webkit-appearance: none;
  }

  /* -- Keyframes --------------------------------------------------- */
  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
`,eY=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let eJ=class extends i.oi{constructor(){super(...arguments),this.inputElementRef=eN(),this.disabled=!1,this.loading=!1,this.placeholder="",this.type="text",this.value="",this.size="md"}render(){return(0,i.dy)` <div class="wui-input-text-container">
        ${this.templateLeftIcon()}
        <input
          data-size=${this.size}
          ${ez(this.inputElementRef)}
          data-testid="wui-input-text"
          type=${this.type}
          enterkeyhint=${(0,d.o)(this.enterKeyHint)}
          ?disabled=${this.disabled}
          placeholder=${this.placeholder}
          @input=${this.dispatchInputChangeEvent.bind(this)}
          @keydown=${this.onKeyDown}
          .value=${this.value||""}
        />
        ${this.templateSubmitButton()}
        <slot class="wui-input-text-slot"></slot>
      </div>
      ${this.templateError()} ${this.templateWarning()}`}templateLeftIcon(){return this.icon?(0,i.dy)`<wui-icon
        class="wui-input-text-left-icon"
        size="md"
        data-size=${this.size}
        color="inherit"
        name=${this.icon}
      ></wui-icon>`:null}templateSubmitButton(){return this.onSubmit?(0,i.dy)`<button
        class="wui-input-text-submit-button ${this.loading?"loading":""}"
        @click=${this.onSubmit?.bind(this)}
        ?disabled=${this.disabled||this.loading}
      >
        ${this.loading?(0,i.dy)`<wui-icon name="spinner" size="md"></wui-icon>`:(0,i.dy)`<wui-icon name="chevronRight" size="md"></wui-icon>`}
      </button>`:null}templateError(){return this.errorText?(0,i.dy)`<wui-text variant="sm-regular" color="error">${this.errorText}</wui-text>`:null}templateWarning(){return this.warningText?(0,i.dy)`<wui-text variant="sm-regular" color="warning">${this.warningText}</wui-text>`:null}dispatchInputChangeEvent(){this.dispatchEvent(new CustomEvent("inputChange",{detail:this.inputElementRef.value?.value,bubbles:!0,composed:!0}))}};eJ.styles=[P.ET,P.ZM,eV],eY([(0,r.Cb)()],eJ.prototype,"icon",void 0),eY([(0,r.Cb)({type:Boolean})],eJ.prototype,"disabled",void 0),eY([(0,r.Cb)({type:Boolean})],eJ.prototype,"loading",void 0),eY([(0,r.Cb)()],eJ.prototype,"placeholder",void 0),eY([(0,r.Cb)()],eJ.prototype,"type",void 0),eY([(0,r.Cb)()],eJ.prototype,"value",void 0),eY([(0,r.Cb)()],eJ.prototype,"errorText",void 0),eY([(0,r.Cb)()],eJ.prototype,"warningText",void 0),eY([(0,r.Cb)()],eJ.prototype,"onSubmit",void 0),eY([(0,r.Cb)()],eJ.prototype,"size",void 0),eY([(0,r.Cb)({attribute:!1})],eJ.prototype,"onKeyDown",void 0),eJ=eY([(0,B.M)("wui-input-text")],eJ);var eX=(0,L.iv)`
  :host {
    position: relative;
    display: inline-block;
    width: 100%;
  }

  wui-icon {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    right: ${({spacing:e})=>e[3]};
    color: ${({tokens:e})=>e.theme.iconDefault};
    cursor: pointer;
    padding: ${({spacing:e})=>e[2]};
    background-color: transparent;
    border-radius: ${({borderRadius:e})=>e[4]};
    transition: background-color ${({durations:e})=>e.lg}
      ${({easings:e})=>e["ease-out-power-2"]};
  }

  @media (hover: hover) {
    wui-icon:hover {
      background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    }
  }
`,eQ=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let eG=class extends i.oi{constructor(){super(...arguments),this.inputComponentRef=eN(),this.inputValue=""}render(){return(0,i.dy)`
      <wui-input-text
        ${ez(this.inputComponentRef)}
        placeholder="Search wallet"
        icon="search"
        type="search"
        enterKeyHint="search"
        size="sm"
        @inputChange=${this.onInputChange}
      >
        ${this.inputValue?(0,i.dy)`<wui-icon
              @click=${this.clearValue}
              color="inherit"
              size="sm"
              name="close"
            ></wui-icon>`:null}
      </wui-input-text>
    `}onInputChange(e){this.inputValue=e.detail||""}clearValue(){let e=this.inputComponentRef.value,t=e?.inputElementRef.value;t&&(t.value="",this.inputValue="",t.focus(),t.dispatchEvent(new Event("input")))}};eG.styles=[P.ET,eX],eQ([(0,r.Cb)()],eG.prototype,"inputValue",void 0),eG=eQ([(0,B.M)("wui-search-bar")],eG);var eZ=o(29095),e0=o(24348);o(42653);var e1=(0,L.iv)`
  :host {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    height: 104px;
    width: 104px;
    row-gap: ${({spacing:e})=>e[2]};
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    border-radius: ${({borderRadius:e})=>e[5]};
    position: relative;
  }

  wui-shimmer[data-type='network'] {
    border: none;
    -webkit-clip-path: var(--apkt-path-network);
    clip-path: var(--apkt-path-network);
  }

  svg {
    position: absolute;
    width: 48px;
    height: 54px;
    z-index: 1;
  }

  svg > path {
    stroke: ${({tokens:e})=>e.theme.foregroundSecondary};
    stroke-width: 1px;
  }

  @media (max-width: 350px) {
    :host {
      width: 100%;
    }
  }
`,e3=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let e2=class extends i.oi{constructor(){super(...arguments),this.type="wallet"}render(){return(0,i.dy)`
      ${this.shimmerTemplate()}
      <wui-shimmer width="80px" height="20px"></wui-shimmer>
    `}shimmerTemplate(){return"network"===this.type?(0,i.dy)` <wui-shimmer data-type=${this.type} width="48px" height="54px"></wui-shimmer>
        ${e0.W}`:(0,i.dy)`<wui-shimmer width="56px" height="56px"></wui-shimmer>`}};e2.styles=[P.ET,P.ZM,e1],e3([(0,r.Cb)()],e2.prototype,"type",void 0),e2=e3([(0,B.M)("wui-card-select-loader")],e2);var e5=o(3874),e4=(0,i.iv)`
  :host {
    display: grid;
    width: inherit;
    height: inherit;
  }
`,e6=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let e8=class extends i.oi{render(){return this.style.cssText=`
      grid-template-rows: ${this.gridTemplateRows};
      grid-template-columns: ${this.gridTemplateColumns};
      justify-items: ${this.justifyItems};
      align-items: ${this.alignItems};
      justify-content: ${this.justifyContent};
      align-content: ${this.alignContent};
      column-gap: ${this.columnGap&&`var(--apkt-spacing-${this.columnGap})`};
      row-gap: ${this.rowGap&&`var(--apkt-spacing-${this.rowGap})`};
      gap: ${this.gap&&`var(--apkt-spacing-${this.gap})`};
      padding-top: ${this.padding&&e5.H.getSpacingStyles(this.padding,0)};
      padding-right: ${this.padding&&e5.H.getSpacingStyles(this.padding,1)};
      padding-bottom: ${this.padding&&e5.H.getSpacingStyles(this.padding,2)};
      padding-left: ${this.padding&&e5.H.getSpacingStyles(this.padding,3)};
      margin-top: ${this.margin&&e5.H.getSpacingStyles(this.margin,0)};
      margin-right: ${this.margin&&e5.H.getSpacingStyles(this.margin,1)};
      margin-bottom: ${this.margin&&e5.H.getSpacingStyles(this.margin,2)};
      margin-left: ${this.margin&&e5.H.getSpacingStyles(this.margin,3)};
    `,(0,i.dy)`<slot></slot>`}};e8.styles=[P.ET,e4],e6([(0,r.Cb)()],e8.prototype,"gridTemplateRows",void 0),e6([(0,r.Cb)()],e8.prototype,"gridTemplateColumns",void 0),e6([(0,r.Cb)()],e8.prototype,"justifyItems",void 0),e6([(0,r.Cb)()],e8.prototype,"alignItems",void 0),e6([(0,r.Cb)()],e8.prototype,"justifyContent",void 0),e6([(0,r.Cb)()],e8.prototype,"alignContent",void 0),e6([(0,r.Cb)()],e8.prototype,"columnGap",void 0),e6([(0,r.Cb)()],e8.prototype,"rowGap",void 0),e6([(0,r.Cb)()],e8.prototype,"gap",void 0),e6([(0,r.Cb)()],e8.prototype,"padding",void 0),e6([(0,r.Cb)()],e8.prototype,"margin",void 0),e8=e6([(0,B.M)("wui-grid")],e8);var e7=(0,c.iv)`
  button {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    cursor: pointer;
    width: 104px;
    row-gap: ${({spacing:e})=>e["2"]};
    padding: ${({spacing:e})=>e["3"]} ${({spacing:e})=>e["0"]};
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    border-radius: clamp(0px, ${({borderRadius:e})=>e["4"]}, 20px);
    transition:
      color ${({durations:e})=>e.lg} ${({easings:e})=>e["ease-out-power-1"]},
      background-color ${({durations:e})=>e.lg}
        ${({easings:e})=>e["ease-out-power-1"]},
      border-radius ${({durations:e})=>e.lg}
        ${({easings:e})=>e["ease-out-power-1"]};
    will-change: background-color, color, border-radius;
    outline: none;
    border: none;
  }

  button > wui-flex > wui-text {
    color: ${({tokens:e})=>e.theme.textPrimary};
    max-width: 86px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    justify-content: center;
  }

  button > wui-flex > wui-text.certified {
    max-width: 66px;
  }

  @media (hover: hover) and (pointer: fine) {
    button:hover:enabled {
      background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    }
  }

  button:disabled > wui-flex > wui-text {
    color: ${({tokens:e})=>e.core.glass010};
  }

  [data-selected='true'] {
    background-color: ${({colors:e})=>e.accent020};
  }

  @media (hover: hover) and (pointer: fine) {
    [data-selected='true']:hover:enabled {
      background-color: ${({colors:e})=>e.accent010};
    }
  }

  [data-selected='true']:active:enabled {
    background-color: ${({colors:e})=>e.accent010};
  }

  @media (max-width: 350px) {
    button {
      width: 100%;
    }
  }
`,e9=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let te=class extends i.oi{constructor(){super(),this.observer=new IntersectionObserver(()=>void 0),this.visible=!1,this.imageSrc=void 0,this.imageLoading=!1,this.isImpressed=!1,this.explorerId="",this.walletQuery="",this.certified=!1,this.displayIndex=0,this.wallet=void 0,this.observer=new IntersectionObserver(e=>{e.forEach(e=>{e.isIntersecting?(this.visible=!0,this.fetchImageSrc(),this.sendImpressionEvent()):this.visible=!1})},{threshold:.01})}firstUpdated(){this.observer.observe(this)}disconnectedCallback(){this.observer.disconnect()}render(){let e=this.wallet?.badge_type==="certified";return(0,i.dy)`
      <button>
        ${this.imageTemplate()}
        <wui-flex flexDirection="row" alignItems="center" justifyContent="center" gap="1">
          <wui-text
            variant="md-regular"
            color="inherit"
            class=${(0,d.o)(e?"certified":void 0)}
            >${this.wallet?.name}</wui-text
          >
          ${e?(0,i.dy)`<wui-icon size="sm" name="walletConnectBrown"></wui-icon>`:null}
        </wui-flex>
      </button>
    `}imageTemplate(){return(this.visible||this.imageSrc)&&!this.imageLoading?(0,i.dy)`
      <wui-wallet-image
        size="lg"
        imageSrc=${(0,d.o)(this.imageSrc)}
        name=${(0,d.o)(this.wallet?.name)}
        .installed=${this.wallet?.installed??!1}
        badgeSize="sm"
      >
      </wui-wallet-image>
    `:this.shimmerTemplate()}shimmerTemplate(){return(0,i.dy)`<wui-shimmer width="56px" height="56px"></wui-shimmer>`}async fetchImageSrc(){this.wallet&&(this.imageSrc=v.f.getWalletImage(this.wallet),this.imageSrc||(this.imageLoading=!0,this.imageSrc=await v.f.fetchWalletImage(this.wallet.image_id),this.imageLoading=!1))}sendImpressionEvent(){this.wallet&&!this.isImpressed&&(this.isImpressed=!0,g.X.sendWalletImpressionEvent({name:this.wallet.name,walletRank:this.wallet.order,explorerId:this.explorerId,view:f.RouterController.state.view,query:this.walletQuery,certified:this.certified,displayIndex:this.displayIndex}))}};te.styles=e7,e9([(0,r.SB)()],te.prototype,"visible",void 0),e9([(0,r.SB)()],te.prototype,"imageSrc",void 0),e9([(0,r.SB)()],te.prototype,"imageLoading",void 0),e9([(0,r.SB)()],te.prototype,"isImpressed",void 0),e9([(0,r.Cb)()],te.prototype,"explorerId",void 0),e9([(0,r.Cb)()],te.prototype,"walletQuery",void 0),e9([(0,r.Cb)()],te.prototype,"certified",void 0),e9([(0,r.Cb)()],te.prototype,"displayIndex",void 0),e9([(0,r.Cb)({type:Object})],te.prototype,"wallet",void 0),te=e9([(0,c.Mo)("w3m-all-wallets-list-item")],te);var tt=(0,c.iv)`
  wui-grid {
    max-height: clamp(360px, 400px, 80vh);
    overflow: scroll;
    scrollbar-width: none;
    grid-auto-rows: min-content;
    grid-template-columns: repeat(auto-fill, 104px);
  }

  :host([data-mobile-fullscreen='true']) wui-grid {
    max-height: none;
  }

  @media (max-width: 350px) {
    wui-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  wui-grid[data-scroll='false'] {
    overflow: hidden;
  }

  wui-grid::-webkit-scrollbar {
    display: none;
  }

  w3m-all-wallets-list-item {
    opacity: 0;
    animation-duration: ${({durations:e})=>e.xl};
    animation-timing-function: ${({easings:e})=>e["ease-inout-power-2"]};
    animation-name: fade-in;
    animation-fill-mode: forwards;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  wui-loading-spinner {
    padding-top: ${({spacing:e})=>e["4"]};
    padding-bottom: ${({spacing:e})=>e["4"]};
    justify-content: center;
    grid-column: 1 / span 4;
  }
`,to=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let ti="local-paginator",tr=class extends i.oi{constructor(){super(),this.unsubscribe=[],this.paginationObserver=void 0,this.loading=!a.ApiController.state.wallets.length,this.wallets=a.ApiController.state.wallets,this.mobileFullScreen=l.OptionsController.state.enableMobileFullScreen,this.unsubscribe.push(a.ApiController.subscribeKey("wallets",e=>this.wallets=e))}firstUpdated(){this.initialFetch(),this.createPaginationObserver()}disconnectedCallback(){this.unsubscribe.forEach(e=>e()),this.paginationObserver?.disconnect()}render(){return this.mobileFullScreen&&this.setAttribute("data-mobile-fullscreen","true"),(0,i.dy)`
      <wui-grid
        data-scroll=${!this.loading}
        .padding=${["0","3","3","3"]}
        gap="2"
        justifyContent="space-between"
      >
        ${this.loading?this.shimmerTemplate(16):this.walletsTemplate()}
        ${this.paginationLoaderTemplate()}
      </wui-grid>
    `}async initialFetch(){this.loading=!0;let e=this.shadowRoot?.querySelector("wui-grid");e&&(await a.ApiController.fetchWalletsByPage({page:1}),await e.animate([{opacity:1},{opacity:0}],{duration:200,fill:"forwards",easing:"ease"}).finished,this.loading=!1,e.animate([{opacity:0},{opacity:1}],{duration:200,fill:"forwards",easing:"ease"}))}shimmerTemplate(e,t){return[...Array(e)].map(()=>(0,i.dy)`
        <wui-card-select-loader type="wallet" id=${(0,d.o)(t)}></wui-card-select-loader>
      `)}walletsTemplate(){return eZ.J.getWalletConnectWallets(this.wallets).map((e,t)=>(0,i.dy)`
        <w3m-all-wallets-list-item
          data-testid="wallet-search-item-${e.id}"
          @click=${()=>this.onConnectWallet(e)}
          .wallet=${e}
          explorerId=${e.id}
          certified=${"certified"===this.badge}
          displayIndex=${t}
        ></w3m-all-wallets-list-item>
      `)}paginationLoaderTemplate(){let{wallets:e,recommended:t,featured:o,count:i,mobileFilteredOutWalletsLength:r}=a.ApiController.state,n=window.innerWidth<352?3:4,l=e.length+t.length,s=Math.ceil(l/n)*n-l+n;return(s-=e.length?o.length%n:0,0===i&&o.length>0)?null:0===i||[...o,...e,...t].length<i-(r??0)?this.shimmerTemplate(s,ti):null}createPaginationObserver(){let e=this.shadowRoot?.querySelector(`#${ti}`);e&&(this.paginationObserver=new IntersectionObserver(([e])=>{if(e?.isIntersecting&&!this.loading){let{page:e,count:t,wallets:o}=a.ApiController.state;o.length<t&&a.ApiController.fetchWalletsByPage({page:e+1})}}),this.paginationObserver.observe(e))}onConnectWallet(e){h.ConnectorController.selectWalletConnector(e)}};tr.styles=tt,to([(0,r.SB)()],tr.prototype,"loading",void 0),to([(0,r.SB)()],tr.prototype,"wallets",void 0),to([(0,r.SB)()],tr.prototype,"badge",void 0),to([(0,r.SB)()],tr.prototype,"mobileFullScreen",void 0),tr=to([(0,c.Mo)("w3m-all-wallets-list")],tr),o(81255);var tn=(0,i.iv)`
  wui-grid,
  wui-loading-spinner,
  wui-flex {
    height: 360px;
  }

  wui-grid {
    overflow: scroll;
    scrollbar-width: none;
    grid-auto-rows: min-content;
    grid-template-columns: repeat(auto-fill, 104px);
  }

  :host([data-mobile-fullscreen='true']) wui-grid {
    max-height: none;
    height: auto;
  }

  wui-grid[data-scroll='false'] {
    overflow: hidden;
  }

  wui-grid::-webkit-scrollbar {
    display: none;
  }

  wui-loading-spinner {
    justify-content: center;
    align-items: center;
  }

  @media (max-width: 350px) {
    wui-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
`,tl=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let ta=class extends i.oi{constructor(){super(...arguments),this.prevQuery="",this.prevBadge=void 0,this.loading=!0,this.mobileFullScreen=l.OptionsController.state.enableMobileFullScreen,this.query=""}render(){return this.mobileFullScreen&&this.setAttribute("data-mobile-fullscreen","true"),this.onSearch(),this.loading?(0,i.dy)`<wui-loading-spinner color="accent-primary"></wui-loading-spinner>`:this.walletsTemplate()}async onSearch(){(this.query.trim()!==this.prevQuery.trim()||this.badge!==this.prevBadge)&&(this.prevQuery=this.query,this.prevBadge=this.badge,this.loading=!0,await a.ApiController.searchWallet({search:this.query,badge:this.badge}),this.loading=!1)}walletsTemplate(){let{search:e}=a.ApiController.state,t=eZ.J.markWalletsAsInstalled(e),o=eZ.J.filterWalletsByWcSupport(t);return o.length?(0,i.dy)`
      <wui-grid
        data-testid="wallet-list"
        .padding=${["0","3","3","3"]}
        rowGap="4"
        columngap="2"
        justifyContent="space-between"
      >
        ${o.map((e,t)=>(0,i.dy)`
            <w3m-all-wallets-list-item
              @click=${()=>this.onConnectWallet(e)}
              .wallet=${e}
              data-testid="wallet-search-item-${e.id}"
              explorerId=${e.id}
              certified=${"certified"===this.badge}
              walletQuery=${this.query}
              displayIndex=${t}
            ></w3m-all-wallets-list-item>
          `)}
      </wui-grid>
    `:(0,i.dy)`
        <wui-flex
          data-testid="no-wallet-found"
          justifyContent="center"
          alignItems="center"
          gap="3"
          flexDirection="column"
        >
          <wui-icon-box size="lg" color="default" icon="wallet"></wui-icon-box>
          <wui-text data-testid="no-wallet-found-text" color="secondary" variant="md-medium">
            No Wallet found
          </wui-text>
        </wui-flex>
      `}onConnectWallet(e){h.ConnectorController.selectWalletConnector(e)}};ta.styles=tn,tl([(0,r.SB)()],ta.prototype,"loading",void 0),tl([(0,r.SB)()],ta.prototype,"mobileFullScreen",void 0),tl([(0,r.Cb)()],ta.prototype,"query",void 0),tl([(0,r.Cb)()],ta.prototype,"badge",void 0),ta=tl([(0,c.Mo)("w3m-all-wallets-search")],ta);var ts=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l};let tc=class extends i.oi{constructor(){super(...arguments),this.search="",this.badge=void 0,this.onDebouncedSearch=n.j.debounce(e=>{this.search=e})}render(){let e=this.search.length>=2;return(0,i.dy)`
      <wui-flex .padding=${["1","3","3","3"]} gap="2" alignItems="center">
        <wui-search-bar @inputChange=${this.onInputChange.bind(this)}></wui-search-bar>
        <wui-certified-switch
          ?checked=${"certified"===this.badge}
          @certifiedSwitchChange=${this.onCertifiedSwitchChange.bind(this)}
          data-testid="wui-certified-switch"
        ></wui-certified-switch>
        ${this.qrButtonTemplate()}
      </wui-flex>
      ${e||this.badge?(0,i.dy)`<w3m-all-wallets-search
            query=${this.search}
            .badge=${this.badge}
          ></w3m-all-wallets-search>`:(0,i.dy)`<w3m-all-wallets-list .badge=${this.badge}></w3m-all-wallets-list>`}
    `}onInputChange(e){this.onDebouncedSearch(e.detail)}onCertifiedSwitchChange(e){e.detail?(this.badge="certified",S.SnackController.showSvg("Only WalletConnect certified",{icon:"walletConnectBrown",iconColor:"accent-100"})):this.badge=void 0}qrButtonTemplate(){return n.j.isMobile()?(0,i.dy)`
        <wui-icon-box
          size="xl"
          iconSize="xl"
          color="accent-primary"
          icon="qrCode"
          border
          borderColor="wui-accent-glass-010"
          @click=${this.onWalletConnectQr.bind(this)}
        ></wui-icon-box>
      `:null}onWalletConnectQr(){f.RouterController.push("ConnectingWalletConnect")}};ts([(0,r.SB)()],tc.prototype,"search",void 0),ts([(0,r.SB)()],tc.prototype,"badge",void 0),tc=ts([(0,c.Mo)("w3m-all-wallets-view")],tc),o(53774);let td=class extends i.oi{constructor(){super(...arguments),this.wallet=f.RouterController.state.data?.wallet}render(){if(!this.wallet)throw Error("w3m-downloads-view");return(0,i.dy)`
      <wui-flex gap="2" flexDirection="column" .padding=${["3","3","4","3"]}>
        ${this.chromeTemplate()} ${this.iosTemplate()} ${this.androidTemplate()}
        ${this.homepageTemplate()}
      </wui-flex>
    `}chromeTemplate(){return this.wallet?.chrome_store?(0,i.dy)`<wui-list-item
      variant="icon"
      icon="chromeStore"
      iconVariant="square"
      @click=${this.onChromeStore.bind(this)}
      chevron
    >
      <wui-text variant="md-medium" color="primary">Chrome Extension</wui-text>
    </wui-list-item>`:null}iosTemplate(){return this.wallet?.app_store?(0,i.dy)`<wui-list-item
      variant="icon"
      icon="appStore"
      iconVariant="square"
      @click=${this.onAppStore.bind(this)}
      chevron
    >
      <wui-text variant="md-medium" color="primary">iOS App</wui-text>
    </wui-list-item>`:null}androidTemplate(){return this.wallet?.play_store?(0,i.dy)`<wui-list-item
      variant="icon"
      icon="playStore"
      iconVariant="square"
      @click=${this.onPlayStore.bind(this)}
      chevron
    >
      <wui-text variant="md-medium" color="primary">Android App</wui-text>
    </wui-list-item>`:null}homepageTemplate(){return this.wallet?.homepage?(0,i.dy)`
      <wui-list-item
        variant="icon"
        icon="browser"
        iconVariant="square-blue"
        @click=${this.onHomePage.bind(this)}
        chevron
      >
        <wui-text variant="md-medium" color="primary">Website</wui-text>
      </wui-list-item>
    `:null}openStore(e){e.href&&this.wallet&&(g.X.sendEvent({type:"track",event:"GET_WALLET",properties:{name:this.wallet.name,walletRank:this.wallet.order,explorerId:this.wallet.id,type:e.type}}),n.j.openHref(e.href,"_blank"))}onChromeStore(){this.wallet?.chrome_store&&this.openStore({href:this.wallet.chrome_store,type:"chrome_store"})}onAppStore(){this.wallet?.app_store&&this.openStore({href:this.wallet.app_store,type:"app_store"})}onPlayStore(){this.wallet?.play_store&&this.openStore({href:this.wallet.play_store,type:"play_store"})}onHomePage(){this.wallet?.homepage&&this.openStore({href:this.wallet.homepage,type:"homepage"})}};td=function(e,t,o,i){var r,n=arguments.length,l=n<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)l=Reflect.decorate(e,t,o,i);else for(var a=e.length-1;a>=0;a--)(r=e[a])&&(l=(n<3?r(l):n>3?r(t,o,l):r(t,o))||l);return n>3&&l&&Object.defineProperty(t,o,l),l}([(0,c.Mo)("w3m-downloads-view")],td)}}]);