"use strict";(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[3950],{63950:function(e,t,o){o.r(t),o.d(t,{AppKitModal:function(){return or},W3mListWallet:function(){return od},W3mModal:function(){return oi},W3mModalBase:function(){return oo},W3mRouterContainer:function(){return oh},W3mUsageExceededView:function(){return on}});var i=o(31133),r=o(19848),a=o(32801),n=o(5688),s=o(49425),c=o(95221),l=o(35652),d=o(17766),u=o(86777),p=o(29562),h=o(60389);let m={isUnsupportedChainView:()=>"UnsupportedChain"===u.RouterController.state.view||"SwitchNetwork"===u.RouterController.state.view&&u.RouterController.state.history.includes("UnsupportedChain"),async safeClose(){if(this.isUnsupportedChainView()||await h.w.isSIWXCloseDisabled()){s.I.shake();return}("DataCapture"===u.RouterController.state.view||"DataCaptureOtpConfirm"===u.RouterController.state.view)&&p.ConnectionController.disconnect(),s.I.close()}};var w=o(52005),g=o(66909),y=o(69887),f=o(55543),b=o(23614),v=o(44649),k=o(4786),x=o(98388),C=o(43291),S=o(97159),T=o(53357),A=o(87280);let I={getGasPriceInEther:(e,t)=>Number(t*e)/1e18,getGasPriceInUSD(e,t,o){let i=I.getGasPriceInEther(t,o);return b.C.bigNumber(e).times(i).toNumber()},getPriceImpact({sourceTokenAmount:e,sourceTokenPriceInUSD:t,toTokenPriceInUSD:o,toTokenAmount:i}){let r=b.C.bigNumber(e).times(t),a=b.C.bigNumber(i).times(o);return r.minus(a).div(r).times(100).toNumber()},getMaxSlippage(e,t){let o=b.C.bigNumber(e).div(100);return b.C.multiply(t,o).toNumber()},getProviderFee:(e,t=.0085)=>b.C.bigNumber(e).times(t).toString(),isInsufficientNetworkTokenForGas:(e,t)=>!!b.C.bigNumber(e).eq(0)||b.C.bigNumber(b.C.bigNumber(t||"0")).gt(e),isInsufficientSourceTokenForSwap(e,t,o){let i=o?.find(e=>e.address===t)?.quantity?.numeric;return b.C.bigNumber(i||"0").lt(e)}};var E=o(59388),P=o(72723),$=o(61704),N=o(31929);let R={initializing:!1,initialized:!1,loadingPrices:!1,loadingQuote:!1,loadingApprovalTransaction:!1,loadingBuildTransaction:!1,loadingTransaction:!1,switchingTokens:!1,fetchError:!1,approvalTransaction:void 0,swapTransaction:void 0,transactionError:void 0,sourceToken:void 0,sourceTokenAmount:"",sourceTokenPriceInUSD:0,toToken:void 0,toTokenAmount:"",toTokenPriceInUSD:0,networkPrice:"0",networkBalanceInUSD:"0",networkTokenSymbol:"",inputError:void 0,slippage:S.bq.CONVERT_SLIPPAGE_TOLERANCE,tokens:void 0,popularTokens:void 0,suggestedTokens:void 0,foundTokens:void 0,myTokensWithBalance:void 0,tokensPriceMap:{},gasFee:"0",gasPriceInUSD:0,priceImpact:void 0,maxSlippage:void 0,providerFee:void 0},O=(0,y.sj)({...R}),_={state:O,subscribe:e=>(0,y.Ld)(O,()=>e(O)),subscribeKey:(e,t)=>(0,f.VW)(O,e,t),getParams(){let e=c.R.state.activeChain,t=c.R.getAccountData(e)?.caipAddress??c.R.state.activeCaipAddress,o=T.j.getPlainAddress(t),i=(0,C.EO)(),r=l.ConnectorController.getConnectorId(c.R.state.activeChain);if(!o)throw Error("No address found to swap the tokens from.");let a=!O.toToken?.address||!O.toToken?.decimals,n=!O.sourceToken?.address||!O.sourceToken?.decimals||!b.C.bigNumber(O.sourceTokenAmount).gt(0),s=!O.sourceTokenAmount;return{networkAddress:i,fromAddress:o,fromCaipAddress:t,sourceTokenAddress:O.sourceToken?.address,toTokenAddress:O.toToken?.address,toTokenAmount:O.toTokenAmount,toTokenDecimals:O.toToken?.decimals,sourceTokenAmount:O.sourceTokenAmount,sourceTokenDecimals:O.sourceToken?.decimals,invalidToToken:a,invalidSourceToken:n,invalidSourceTokenAmount:s,availableToSwap:t&&!a&&!n&&!s,isAuthConnector:r===v.b.CONNECTOR_ID.AUTH}},async setSourceToken(e){if(!e){O.sourceToken=e,O.sourceTokenAmount="",O.sourceTokenPriceInUSD=0;return}O.sourceToken=e,await B.setTokenPrice(e.address,"sourceToken")},setSourceTokenAmount(e){O.sourceTokenAmount=e},async setToToken(e){if(!e){O.toToken=e,O.toTokenAmount="",O.toTokenPriceInUSD=0;return}O.toToken=e,await B.setTokenPrice(e.address,"toToken")},setToTokenAmount(e){O.toTokenAmount=e?b.C.toFixed(e,6):""},async setTokenPrice(e,t){let o=O.tokensPriceMap[e]||0;o||(O.loadingPrices=!0,o=await B.getAddressPrice(e)),"sourceToken"===t?O.sourceTokenPriceInUSD=o:"toToken"===t&&(O.toTokenPriceInUSD=o),O.loadingPrices&&(O.loadingPrices=!1),B.getParams().availableToSwap&&!O.switchingTokens&&B.swapTokens()},async switchTokens(){if(!O.initializing&&O.initialized&&!O.switchingTokens){O.switchingTokens=!0;try{let e=O.toToken?{...O.toToken}:void 0,t=O.sourceToken?{...O.sourceToken}:void 0,o=e&&""===O.toTokenAmount?"1":O.toTokenAmount;B.setSourceTokenAmount(o),B.setToTokenAmount(""),await B.setSourceToken(e),await B.setToToken(t),O.switchingTokens=!1,B.swapTokens()}catch(e){throw O.switchingTokens=!1,e}}},resetState(){O.myTokensWithBalance=R.myTokensWithBalance,O.tokensPriceMap=R.tokensPriceMap,O.initialized=R.initialized,O.initializing=R.initializing,O.switchingTokens=R.switchingTokens,O.sourceToken=R.sourceToken,O.sourceTokenAmount=R.sourceTokenAmount,O.sourceTokenPriceInUSD=R.sourceTokenPriceInUSD,O.toToken=R.toToken,O.toTokenAmount=R.toTokenAmount,O.toTokenPriceInUSD=R.toTokenPriceInUSD,O.networkPrice=R.networkPrice,O.networkTokenSymbol=R.networkTokenSymbol,O.networkBalanceInUSD=R.networkBalanceInUSD,O.inputError=R.inputError},resetValues(){let{networkAddress:e}=B.getParams(),t=O.tokens?.find(t=>t.address===e);B.setSourceToken(t),B.setToToken(void 0)},getApprovalLoadingState:()=>O.loadingApprovalTransaction,clearError(){O.transactionError=void 0},async initializeState(){if(!O.initializing){if(O.initializing=!0,!O.initialized)try{await B.fetchTokens(),O.initialized=!0}catch(e){O.initialized=!1,g.SnackController.showError("Failed to initialize swap"),u.RouterController.goBack()}O.initializing=!1}},async fetchTokens(){let{networkAddress:e}=B.getParams();await B.getNetworkTokenPrice(),await B.getMyTokensWithBalance();let t=O.myTokensWithBalance?.find(t=>t.address===e);t&&(O.networkTokenSymbol=t.symbol,B.setSourceToken(t),B.setSourceTokenAmount("0"))},async getTokenList(){let e=c.R.state.activeCaipNetwork?.caipNetworkId;if(O.caipNetworkId!==e||!O.tokens)try{O.tokensLoading=!0;let t=await A.n.getTokenList(e);O.tokens=t,O.caipNetworkId=e,O.popularTokens=t.sort((e,t)=>e.symbol<t.symbol?-1:e.symbol>t.symbol?1:0);let o=(e&&S.bq.SUGGESTED_TOKENS_BY_CHAIN?.[e]||[]).map(e=>t.find(t=>t.symbol===e)).filter(e=>!!e),i=(S.bq.SWAP_SUGGESTED_TOKENS||[]).map(e=>t.find(t=>t.symbol===e)).filter(e=>!!e).filter(e=>!o.some(t=>t.address===e.address));O.suggestedTokens=[...o,...i]}catch(e){O.tokens=[],O.popularTokens=[],O.suggestedTokens=[]}finally{O.tokensLoading=!1}},async getAddressPrice(e){let t=O.tokensPriceMap[e];if(t)return t;let o=await $.L.fetchTokenPrice({addresses:[e]}),i=o?.fungibles||[],r=[...O.tokens||[],...O.myTokensWithBalance||[]],a=r?.find(t=>t.address===e)?.symbol,n=parseFloat((i.find(e=>e.symbol.toLowerCase()===a?.toLowerCase())?.price||0).toString());return O.tokensPriceMap[e]=n,n},async getNetworkTokenPrice(){let{networkAddress:e}=B.getParams(),t=await $.L.fetchTokenPrice({addresses:[e]}).catch(()=>(g.SnackController.showError("Failed to fetch network token price"),{fungibles:[]})),o=t.fungibles?.[0],i=o?.price.toString()||"0";O.tokensPriceMap[e]=parseFloat(i),O.networkTokenSymbol=o?.symbol||"",O.networkPrice=i},async getMyTokensWithBalance(e){let t=await x.Q.getMyTokensWithBalance({forceUpdate:e,caipNetwork:c.R.state.activeCaipNetwork,address:c.R.getAccountData()?.address}),o=A.n.mapBalancesToSwapTokens(t);o&&(await B.getInitialGasPrice(),B.setBalances(o))},setBalances(e){let{networkAddress:t}=B.getParams(),o=c.R.state.activeCaipNetwork;if(!o)return;let i=e.find(e=>e.address===t);e.forEach(e=>{O.tokensPriceMap[e.address]=e.price||0}),O.myTokensWithBalance=e.filter(e=>e.address.startsWith(o.caipNetworkId)),O.networkBalanceInUSD=i?b.C.multiply(i.quantity.numeric,i.price).toString():"0"},async getInitialGasPrice(){let e=await A.n.fetchGasPrice();if(!e)return{gasPrice:null,gasPriceInUSD:null};switch(c.R.state?.activeCaipNetwork?.chainNamespace){case v.b.CHAIN.SOLANA:return O.gasFee=e.standard??"0",O.gasPriceInUSD=b.C.multiply(e.standard,O.networkPrice).div(1e9).toNumber(),{gasPrice:BigInt(O.gasFee),gasPriceInUSD:Number(O.gasPriceInUSD)};case v.b.CHAIN.EVM:default:let t=e.standard??"0",o=BigInt(t),i=BigInt(15e4),r=I.getGasPriceInUSD(O.networkPrice,i,o);return O.gasFee=t,O.gasPriceInUSD=r,{gasPrice:o,gasPriceInUSD:r}}},async swapTokens(){let e=c.R.getAccountData()?.address,t=O.sourceToken,o=O.toToken,i=b.C.bigNumber(O.sourceTokenAmount).gt(0);if(i||B.setToTokenAmount(""),!o||!t||O.loadingPrices||!i||!e)return;O.loadingQuote=!0;let r=b.C.bigNumber(O.sourceTokenAmount).times(10**t.decimals).round(0).toFixed(0);try{let i=await $.L.fetchSwapQuote({userAddress:e,from:t.address,to:o.address,gasPrice:O.gasFee,amount:r.toString()});O.loadingQuote=!1;let a=i?.quotes?.[0]?.toAmount;if(!a){P.AlertController.open({displayMessage:"Incorrect amount",debugMessage:"Please enter a valid amount"},"error");return}let n=b.C.bigNumber(a).div(10**o.decimals).toString();B.setToTokenAmount(n),B.hasInsufficientToken(O.sourceTokenAmount,t.address)?O.inputError="Insufficient balance":(O.inputError=void 0,B.setTransactionDetails())}catch(t){let e=await A.n.handleSwapError(t);O.loadingQuote=!1,O.inputError=e||"Insufficient balance"}},async getTransaction(){let{fromCaipAddress:e,availableToSwap:t}=B.getParams(),o=O.sourceToken,i=O.toToken;if(e&&t&&o&&i&&!O.loadingQuote)try{let t;return O.loadingBuildTransaction=!0,t=await A.n.fetchSwapAllowance({userAddress:e,tokenAddress:o.address,sourceTokenAmount:O.sourceTokenAmount,sourceTokenDecimals:o.decimals})?await B.createSwapTransaction():await B.createAllowanceTransaction(),O.loadingBuildTransaction=!1,O.fetchError=!1,t}catch(e){u.RouterController.goBack(),g.SnackController.showError("Failed to check allowance"),O.loadingBuildTransaction=!1,O.approvalTransaction=void 0,O.swapTransaction=void 0,O.fetchError=!0;return}},async createAllowanceTransaction(){let{fromCaipAddress:e,sourceTokenAddress:t,toTokenAddress:o}=B.getParams();if(e&&o){if(!t)throw Error("createAllowanceTransaction - No source token address found.");try{let i=await $.L.generateApproveCalldata({from:t,to:o,userAddress:e}),r=T.j.getPlainAddress(i.tx.from);if(!r)throw Error("SwapController:createAllowanceTransaction - address is required");let a={data:i.tx.data,to:r,gasPrice:BigInt(i.tx.eip155.gasPrice),value:BigInt(i.tx.value),toAmount:O.toTokenAmount};return O.swapTransaction=void 0,O.approvalTransaction={data:a.data,to:a.to,gasPrice:a.gasPrice,value:a.value,toAmount:a.toAmount},{data:a.data,to:a.to,gasPrice:a.gasPrice,value:a.value,toAmount:a.toAmount}}catch(e){u.RouterController.goBack(),g.SnackController.showError("Failed to create approval transaction"),O.approvalTransaction=void 0,O.swapTransaction=void 0,O.fetchError=!0;return}}},async createSwapTransaction(){let{networkAddress:e,fromCaipAddress:t,sourceTokenAmount:o}=B.getParams(),i=O.sourceToken,r=O.toToken;if(!t||!o||!i||!r)return;let a=p.ConnectionController.parseUnits(o,i.decimals)?.toString();try{let o=await $.L.generateSwapCalldata({userAddress:t,from:i.address,to:r.address,amount:a,disableEstimate:!0}),n=i.address===e,s=BigInt(o.tx.eip155.gas),c=BigInt(o.tx.eip155.gasPrice),l=T.j.getPlainAddress(o.tx.to);if(!l)throw Error("SwapController:createSwapTransaction - address is required");let d={data:o.tx.data,to:l,gas:s,gasPrice:c,value:n?BigInt(a??"0"):BigInt("0"),toAmount:O.toTokenAmount};return O.gasPriceInUSD=I.getGasPriceInUSD(O.networkPrice,s,c),O.approvalTransaction=void 0,O.swapTransaction=d,d}catch(e){u.RouterController.goBack(),g.SnackController.showError("Failed to create transaction"),O.approvalTransaction=void 0,O.swapTransaction=void 0,O.fetchError=!0;return}},onEmbeddedWalletApprovalSuccess(){g.SnackController.showLoading("Approve limit increase in your wallet"),u.RouterController.replace("SwapPreview")},async sendTransactionForApproval(e){let{fromAddress:t,isAuthConnector:o}=B.getParams();O.loadingApprovalTransaction=!0,o?u.RouterController.pushTransactionStack({onSuccess:B.onEmbeddedWalletApprovalSuccess}):g.SnackController.showLoading("Approve limit increase in your wallet");try{await p.ConnectionController.sendTransaction({address:t,to:e.to,data:e.data,value:e.value,chainNamespace:v.b.CHAIN.EVM}),await B.swapTokens(),await B.getTransaction(),O.approvalTransaction=void 0,O.loadingApprovalTransaction=!1}catch(e){O.transactionError=e?.displayMessage,O.loadingApprovalTransaction=!1,g.SnackController.showError(e?.displayMessage||"Transaction error"),N.X.sendEvent({type:"track",event:"SWAP_APPROVAL_ERROR",properties:{message:e?.displayMessage||e?.message||"Unknown",network:c.R.state.activeCaipNetwork?.caipNetworkId||"",swapFromToken:B.state.sourceToken?.symbol||"",swapToToken:B.state.toToken?.symbol||"",swapFromAmount:B.state.sourceTokenAmount||"",swapToAmount:B.state.toTokenAmount||"",isSmartAccount:(0,C.r9)(v.b.CHAIN.EVM)===k.y_.ACCOUNT_TYPES.SMART_ACCOUNT}})}},async sendTransactionForSwap(e){if(!e)return;let{fromAddress:t,toTokenAmount:o,isAuthConnector:i}=B.getParams();O.loadingTransaction=!0;let r=`Swapping ${O.sourceToken?.symbol} to ${b.C.formatNumberToLocalString(o,3)} ${O.toToken?.symbol}`,a=`Swapped ${O.sourceToken?.symbol} to ${b.C.formatNumberToLocalString(o,3)} ${O.toToken?.symbol}`;i?u.RouterController.pushTransactionStack({onSuccess(){u.RouterController.replace("Account"),g.SnackController.showLoading(r),_.resetState()}}):g.SnackController.showLoading("Confirm transaction in your wallet");try{let o=[O.sourceToken?.address,O.toToken?.address].join(","),r=await p.ConnectionController.sendTransaction({address:t,to:e.to,data:e.data,value:e.value,chainNamespace:v.b.CHAIN.EVM});return O.loadingTransaction=!1,g.SnackController.showSuccess(a),N.X.sendEvent({type:"track",event:"SWAP_SUCCESS",properties:{network:c.R.state.activeCaipNetwork?.caipNetworkId||"",swapFromToken:B.state.sourceToken?.symbol||"",swapToToken:B.state.toToken?.symbol||"",swapFromAmount:B.state.sourceTokenAmount||"",swapToAmount:B.state.toTokenAmount||"",isSmartAccount:(0,C.r9)(v.b.CHAIN.EVM)===k.y_.ACCOUNT_TYPES.SMART_ACCOUNT}}),_.resetState(),i||u.RouterController.replace("Account"),_.getMyTokensWithBalance(o),r}catch(e){O.transactionError=e?.displayMessage,O.loadingTransaction=!1,g.SnackController.showError(e?.displayMessage||"Transaction error"),N.X.sendEvent({type:"track",event:"SWAP_ERROR",properties:{message:e?.displayMessage||e?.message||"Unknown",network:c.R.state.activeCaipNetwork?.caipNetworkId||"",swapFromToken:B.state.sourceToken?.symbol||"",swapToToken:B.state.toToken?.symbol||"",swapFromAmount:B.state.sourceTokenAmount||"",swapToAmount:B.state.toTokenAmount||"",isSmartAccount:(0,C.r9)(v.b.CHAIN.EVM)===k.y_.ACCOUNT_TYPES.SMART_ACCOUNT}});return}},hasInsufficientToken:(e,t)=>I.isInsufficientSourceTokenForSwap(e,t,O.myTokensWithBalance),setTransactionDetails(){let{toTokenAddress:e,toTokenDecimals:t}=B.getParams();e&&t&&(O.gasPriceInUSD=I.getGasPriceInUSD(O.networkPrice,BigInt(O.gasFee),BigInt(15e4)),O.priceImpact=I.getPriceImpact({sourceTokenAmount:O.sourceTokenAmount,sourceTokenPriceInUSD:O.sourceTokenPriceInUSD,toTokenPriceInUSD:O.toTokenPriceInUSD,toTokenAmount:O.toTokenAmount}),O.maxSlippage=I.getMaxSlippage(O.slippage,O.toTokenAmount),O.providerFee=I.getProviderFee(O.sourceTokenAmount))}},B=(0,E.P)(_);var U=o(30795),D=o(84249),L=o(57116),W=o(11131),z=(0,W.iv)`
  :host {
    display: block;
    border-radius: clamp(0px, ${({borderRadius:e})=>e["8"]}, 44px);
    box-shadow: 0 0 0 1px ${({tokens:e})=>e.theme.foregroundPrimary};
    overflow: hidden;
  }
`;let j=class extends i.oi{render(){return(0,i.dy)`<slot></slot>`}};j.styles=[D.ET,z],j=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n}([(0,L.M)("wui-card")],j),o(96277),o(30706),o(18360),o(5680);var F=(0,W.iv)`
  :host {
    width: 100%;
  }

  :host > wui-flex {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: ${({spacing:e})=>e[2]};
    padding: ${({spacing:e})=>e[3]};
    border-radius: ${({borderRadius:e})=>e[6]};
    border: 1px solid ${({tokens:e})=>e.theme.borderPrimary};
    box-sizing: border-box;
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    box-shadow: 0px 0px 16px 0px rgba(0, 0, 0, 0.25);
    color: ${({tokens:e})=>e.theme.textPrimary};
  }

  :host > wui-flex[data-type='info'] {
    .icon-box {
      background-color: ${({tokens:e})=>e.theme.foregroundSecondary};

      wui-icon {
        color: ${({tokens:e})=>e.theme.iconDefault};
      }
    }
  }
  :host > wui-flex[data-type='success'] {
    .icon-box {
      background-color: ${({tokens:e})=>e.core.backgroundSuccess};

      wui-icon {
        color: ${({tokens:e})=>e.core.borderSuccess};
      }
    }
  }
  :host > wui-flex[data-type='warning'] {
    .icon-box {
      background-color: ${({tokens:e})=>e.core.backgroundWarning};

      wui-icon {
        color: ${({tokens:e})=>e.core.borderWarning};
      }
    }
  }
  :host > wui-flex[data-type='error'] {
    .icon-box {
      background-color: ${({tokens:e})=>e.core.backgroundError};

      wui-icon {
        color: ${({tokens:e})=>e.core.borderError};
      }
    }
  }

  wui-flex {
    width: 100%;
  }

  wui-text {
    word-break: break-word;
    flex: 1;
  }

  .close {
    cursor: pointer;
    color: ${({tokens:e})=>e.theme.iconDefault};
  }

  .icon-box {
    height: 40px;
    width: 40px;
    border-radius: ${({borderRadius:e})=>e["2"]};
    background-color: var(--local-icon-bg-value);
  }
`,M=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let q={info:"info",success:"checkmark",warning:"warningCircle",error:"warning"},V=class extends i.oi{constructor(){super(...arguments),this.message="",this.type="info"}render(){return(0,i.dy)`
      <wui-flex
        data-type=${(0,a.o)(this.type)}
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        gap="2"
      >
        <wui-flex columnGap="2" flexDirection="row" alignItems="center">
          <wui-flex
            flexDirection="row"
            alignItems="center"
            justifyContent="center"
            class="icon-box"
          >
            <wui-icon color="inherit" size="md" name=${q[this.type]}></wui-icon>
          </wui-flex>
          <wui-text variant="md-medium" color="inherit" data-testid="wui-alertbar-text"
            >${this.message}</wui-text
          >
        </wui-flex>
        <wui-icon
          class="close"
          color="inherit"
          size="sm"
          name="close"
          @click=${this.onClose}
        ></wui-icon>
      </wui-flex>
    `}onClose(){P.AlertController.close()}};V.styles=[D.ET,F],M([(0,r.Cb)()],V.prototype,"message",void 0),M([(0,r.Cb)()],V.prototype,"type",void 0),V=M([(0,L.M)("wui-alertbar")],V);var G=(0,U.iv)`
  :host {
    display: block;
    position: absolute;
    top: ${({spacing:e})=>e["3"]};
    left: ${({spacing:e})=>e["4"]};
    right: ${({spacing:e})=>e["4"]};
    opacity: 0;
    pointer-events: none;
  }
`,H=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let Y={info:{backgroundColor:"fg-350",iconColor:"fg-325",icon:"info"},success:{backgroundColor:"success-glass-reown-020",iconColor:"success-125",icon:"checkmark"},warning:{backgroundColor:"warning-glass-reown-020",iconColor:"warning-100",icon:"warningCircle"},error:{backgroundColor:"error-glass-reown-020",iconColor:"error-125",icon:"warning"}},K=class extends i.oi{constructor(){super(),this.unsubscribe=[],this.open=P.AlertController.state.open,this.onOpen(!0),this.unsubscribe.push(P.AlertController.subscribeKey("open",e=>{this.open=e,this.onOpen(!1)}))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){let{message:e,variant:t}=P.AlertController.state,o=Y[t];return(0,i.dy)`
      <wui-alertbar
        message=${e}
        backgroundColor=${o?.backgroundColor}
        iconColor=${o?.iconColor}
        icon=${o?.icon}
        type=${t}
      ></wui-alertbar>
    `}onOpen(e){this.open?(this.animate([{opacity:0,transform:"scale(0.85)"},{opacity:1,transform:"scale(1)"}],{duration:150,fill:"forwards",easing:"ease"}),this.style.cssText="pointer-events: auto"):e||(this.animate([{opacity:1,transform:"scale(1)"},{opacity:0,transform:"scale(0.85)"}],{duration:150,fill:"forwards",easing:"ease"}),this.style.cssText="pointer-events: none")}};K.styles=G,H([(0,r.SB)()],K.prototype,"open",void 0),K=H([(0,U.Mo)("w3m-alertbar")],K);var Q=o(63043),X=o(22472),Z=(0,W.iv)`
  :host {
    position: relative;
  }

  button {
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: transparent;
    padding: ${({spacing:e})=>e[1]};
  }

  /* -- Colors --------------------------------------------------- */
  button[data-type='accent'] wui-icon {
    color: ${({tokens:e})=>e.core.iconAccentPrimary};
  }

  button[data-type='neutral'][data-variant='primary'] wui-icon {
    color: ${({tokens:e})=>e.theme.iconInverse};
  }

  button[data-type='neutral'][data-variant='secondary'] wui-icon {
    color: ${({tokens:e})=>e.theme.iconDefault};
  }

  button[data-type='success'] wui-icon {
    color: ${({tokens:e})=>e.core.iconSuccess};
  }

  button[data-type='error'] wui-icon {
    color: ${({tokens:e})=>e.core.iconError};
  }

  /* -- Sizes --------------------------------------------------- */
  button[data-size='xs'] {
    width: 16px;
    height: 16px;

    border-radius: ${({borderRadius:e})=>e[1]};
  }

  button[data-size='sm'] {
    width: 20px;
    height: 20px;
    border-radius: ${({borderRadius:e})=>e[1]};
  }

  button[data-size='md'] {
    width: 24px;
    height: 24px;
    border-radius: ${({borderRadius:e})=>e[2]};
  }

  button[data-size='lg'] {
    width: 28px;
    height: 28px;
    border-radius: ${({borderRadius:e})=>e[2]};
  }

  button[data-size='xs'] wui-icon {
    width: 8px;
    height: 8px;
  }

  button[data-size='sm'] wui-icon {
    width: 12px;
    height: 12px;
  }

  button[data-size='md'] wui-icon {
    width: 16px;
    height: 16px;
  }

  button[data-size='lg'] wui-icon {
    width: 20px;
    height: 20px;
  }

  /* -- Hover --------------------------------------------------- */
  @media (hover: hover) {
    button[data-type='accent']:hover:enabled {
      background-color: ${({tokens:e})=>e.core.foregroundAccent010};
    }

    button[data-variant='primary'][data-type='neutral']:hover:enabled {
      background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    }

    button[data-variant='secondary'][data-type='neutral']:hover:enabled {
      background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    }

    button[data-type='success']:hover:enabled {
      background-color: ${({tokens:e})=>e.core.backgroundSuccess};
    }

    button[data-type='error']:hover:enabled {
      background-color: ${({tokens:e})=>e.core.backgroundError};
    }
  }

  /* -- Focus --------------------------------------------------- */
  button:focus-visible {
    box-shadow: 0 0 0 4px ${({tokens:e})=>e.core.foregroundAccent020};
  }

  /* -- Properties --------------------------------------------------- */
  button[data-full-width='true'] {
    width: 100%;
  }

  :host([fullWidth]) {
    width: 100%;
  }

  button[disabled] {
    opacity: 0.5;
    cursor: not-allowed;
  }
`,J=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let ee=class extends i.oi{constructor(){super(...arguments),this.icon="card",this.variant="primary",this.type="accent",this.size="md",this.iconSize=void 0,this.fullWidth=!1,this.disabled=!1}render(){return(0,i.dy)`<button
      data-variant=${this.variant}
      data-type=${this.type}
      data-size=${this.size}
      data-full-width=${this.fullWidth}
      ?disabled=${this.disabled}
    >
      <wui-icon color="inherit" name=${this.icon} size=${(0,a.o)(this.iconSize)}></wui-icon>
    </button>`}};ee.styles=[D.ET,D.ZM,Z],J([(0,r.Cb)()],ee.prototype,"icon",void 0),J([(0,r.Cb)()],ee.prototype,"variant",void 0),J([(0,r.Cb)()],ee.prototype,"type",void 0),J([(0,r.Cb)()],ee.prototype,"size",void 0),J([(0,r.Cb)()],ee.prototype,"iconSize",void 0),J([(0,r.Cb)({type:Boolean})],ee.prototype,"fullWidth",void 0),J([(0,r.Cb)({type:Boolean})],ee.prototype,"disabled",void 0),ee=J([(0,L.M)("wui-icon-button")],ee),o(23805);var et=(0,W.iv)`
  button {
    display: block;
    display: flex;
    align-items: center;
    padding: ${({spacing:e})=>e[1]};
    transition: background-color ${({durations:e})=>e.lg}
      ${({easings:e})=>e["ease-out-power-2"]};
    will-change: background-color;
    border-radius: ${({borderRadius:e})=>e[32]};
  }

  wui-image {
    border-radius: 100%;
  }

  wui-text {
    padding-left: ${({spacing:e})=>e[1]};
  }

  .left-icon-container,
  .right-icon-container {
    width: 24px;
    height: 24px;
    justify-content: center;
    align-items: center;
  }

  wui-icon {
    color: ${({tokens:e})=>e.theme.iconDefault};
  }

  /* -- Sizes --------------------------------------------------- */
  button[data-size='lg'] {
    height: 32px;
  }

  button[data-size='md'] {
    height: 28px;
  }

  button[data-size='sm'] {
    height: 24px;
  }

  button[data-size='lg'] wui-image {
    width: 24px;
    height: 24px;
  }

  button[data-size='md'] wui-image {
    width: 20px;
    height: 20px;
  }

  button[data-size='sm'] wui-image {
    width: 16px;
    height: 16px;
  }

  button[data-size='lg'] .left-icon-container {
    width: 24px;
    height: 24px;
  }

  button[data-size='md'] .left-icon-container {
    width: 20px;
    height: 20px;
  }

  button[data-size='sm'] .left-icon-container {
    width: 16px;
    height: 16px;
  }

  /* -- Variants --------------------------------------------------------- */
  button[data-type='filled-dropdown'] {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
  }

  button[data-type='text-dropdown'] {
    background-color: transparent;
  }

  /* -- Focus states --------------------------------------------------- */
  button:focus-visible:enabled {
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    box-shadow: 0 0 0 4px ${({tokens:e})=>e.core.foregroundAccent040};
  }

  /* -- Hover & Active states ----------------------------------------------------------- */
  @media (hover: hover) and (pointer: fine) {
    button:hover:enabled,
    button:active:enabled {
      background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    }
  }

  /* -- Disabled states --------------------------------------------------- */
  button:disabled {
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    opacity: 0.5;
  }
`,eo=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let ei={lg:"lg-regular",md:"md-regular",sm:"sm-regular"},er={lg:"lg",md:"md",sm:"sm"},ea=class extends i.oi{constructor(){super(...arguments),this.imageSrc="",this.text="",this.size="lg",this.type="text-dropdown",this.disabled=!1}render(){return(0,i.dy)`<button ?disabled=${this.disabled} data-size=${this.size} data-type=${this.type}>
      ${this.imageTemplate()} ${this.textTemplate()}
      <wui-flex class="right-icon-container">
        <wui-icon name="chevronBottom"></wui-icon>
      </wui-flex>
    </button>`}textTemplate(){let e=ei[this.size];return this.text?(0,i.dy)`<wui-text color="primary" variant=${e}>${this.text}</wui-text>`:null}imageTemplate(){if(this.imageSrc)return(0,i.dy)`<wui-image src=${this.imageSrc} alt="select visual"></wui-image>`;let e=er[this.size];return(0,i.dy)` <wui-flex class="left-icon-container">
      <wui-icon size=${e} name="networkPlaceholder"></wui-icon>
    </wui-flex>`}};ea.styles=[D.ET,D.ZM,et],eo([(0,r.Cb)()],ea.prototype,"imageSrc",void 0),eo([(0,r.Cb)()],ea.prototype,"text",void 0),eo([(0,r.Cb)()],ea.prototype,"size",void 0),eo([(0,r.Cb)()],ea.prototype,"type",void 0),eo([(0,r.Cb)({type:Boolean})],ea.prototype,"disabled",void 0),ea=eo([(0,L.M)("wui-select")],ea),o(80675),o(44732);var en=o(40257);let es={ACCOUNT_TABS:[{label:"Tokens"},{label:"Activity"}],SECURE_SITE_ORIGIN:(void 0!==en&&void 0!==en.env?en.env.NEXT_PUBLIC_SECURE_SITE_ORIGIN:void 0)||"https://secure.walletconnect.org",VIEW_DIRECTION:{Next:"next",Prev:"prev"},ANIMATION_DURATIONS:{HeaderText:120,ModalHeight:150,ViewTransition:150},VIEWS_WITH_LEGAL_FOOTER:["Connect","ConnectWallets","OnRampTokenSelect","OnRampFiatSelect","OnRampProviders"],VIEWS_WITH_DEFAULT_FOOTER:["Networks"]};o(97585),o(4594);var ec=(0,W.iv)`
  button {
    background-color: transparent;
    padding: ${({spacing:e})=>e[1]};
  }

  button:focus-visible {
    box-shadow: 0 0 0 4px ${({tokens:e})=>e.core.foregroundAccent020};
  }

  button[data-variant='accent']:hover:enabled,
  button[data-variant='accent']:focus-visible {
    background-color: ${({tokens:e})=>e.core.foregroundAccent010};
  }

  button[data-variant='primary']:hover:enabled,
  button[data-variant='primary']:focus-visible,
  button[data-variant='secondary']:hover:enabled,
  button[data-variant='secondary']:focus-visible {
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
  }

  button[data-size='xs'] > wui-icon {
    width: 8px;
    height: 8px;
  }

  button[data-size='sm'] > wui-icon {
    width: 12px;
    height: 12px;
  }

  button[data-size='xs'],
  button[data-size='sm'] {
    border-radius: ${({borderRadius:e})=>e[1]};
  }

  button[data-size='md'],
  button[data-size='lg'] {
    border-radius: ${({borderRadius:e})=>e[2]};
  }

  button[data-size='md'] > wui-icon {
    width: 16px;
    height: 16px;
  }

  button[data-size='lg'] > wui-icon {
    width: 20px;
    height: 20px;
  }

  button:disabled {
    background-color: transparent;
    cursor: not-allowed;
    opacity: 0.5;
  }

  button:hover:not(:disabled) {
    background-color: var(--wui-color-accent-glass-015);
  }

  button:focus-visible:not(:disabled) {
    background-color: var(--wui-color-accent-glass-015);
    box-shadow:
      inset 0 0 0 1px var(--wui-color-accent-100),
      0 0 0 4px var(--wui-color-accent-glass-020);
  }
`,el=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let ed=class extends i.oi{constructor(){super(...arguments),this.size="md",this.disabled=!1,this.icon="copy",this.iconColor="default",this.variant="accent"}render(){return(0,i.dy)`
      <button data-variant=${this.variant} ?disabled=${this.disabled} data-size=${this.size}>
        <wui-icon
          color=${({accent:"accent-primary",primary:"inverse",secondary:"default"})[this.variant]||this.iconColor}
          size=${this.size}
          name=${this.icon}
        ></wui-icon>
      </button>
    `}};ed.styles=[D.ET,D.ZM,ec],el([(0,r.Cb)()],ed.prototype,"size",void 0),el([(0,r.Cb)({type:Boolean})],ed.prototype,"disabled",void 0),el([(0,r.Cb)()],ed.prototype,"icon",void 0),el([(0,r.Cb)()],ed.prototype,"iconColor",void 0),el([(0,r.Cb)()],ed.prototype,"variant",void 0),ed=el([(0,L.M)("wui-icon-link")],ed),o(53774),o(81255);let eu=(0,i.YP)`<svg width="86" height="96" fill="none">
  <path
    d="M78.3244 18.926L50.1808 2.45078C45.7376 -0.150261 40.2624 -0.150262 35.8192 2.45078L7.6756 18.926C3.23322 21.5266 0.5 26.3301 0.5 31.5248V64.4752C0.5 69.6699 3.23322 74.4734 7.6756 77.074L35.8192 93.5492C40.2624 96.1503 45.7376 96.1503 50.1808 93.5492L78.3244 77.074C82.7668 74.4734 85.5 69.6699 85.5 64.4752V31.5248C85.5 26.3301 82.7668 21.5266 78.3244 18.926Z"
  />
</svg>`;var ep=o(24348);let eh=(0,i.YP)`
  <svg fill="none" viewBox="0 0 36 40">
    <path
      d="M15.4 2.1a5.21 5.21 0 0 1 5.2 0l11.61 6.7a5.21 5.21 0 0 1 2.61 4.52v13.4c0 1.87-1 3.59-2.6 4.52l-11.61 6.7c-1.62.93-3.6.93-5.22 0l-11.6-6.7a5.21 5.21 0 0 1-2.61-4.51v-13.4c0-1.87 1-3.6 2.6-4.52L15.4 2.1Z"
    />
  </svg>
`;var em=(0,W.iv)`
  :host {
    position: relative;
    border-radius: inherit;
    display: flex;
    justify-content: center;
    align-items: center;
    width: var(--local-width);
    height: var(--local-height);
  }

  :host([data-round='true']) {
    background: ${({tokens:e})=>e.theme.foregroundPrimary};
    border-radius: 100%;
    outline: 1px solid ${({tokens:e})=>e.core.glass010};
  }

  svg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    z-index: 1;
  }

  svg > path {
    stroke: var(--local-stroke);
  }

  wui-image {
    width: 100%;
    height: 100%;
    -webkit-clip-path: var(--local-path);
    clip-path: var(--local-path);
    background: ${({tokens:e})=>e.theme.foregroundPrimary};
  }

  wui-icon {
    transform: translateY(-5%);
    width: var(--local-icon-size);
    height: var(--local-icon-size);
  }
`,ew=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let eg=class extends i.oi{constructor(){super(...arguments),this.size="md",this.name="uknown",this.networkImagesBySize={sm:eh,md:ep.W,lg:eu},this.selected=!1,this.round=!1}render(){return this.round?(this.dataset.round="true",this.style.cssText=`
      --local-width: var(--apkt-spacing-10);
      --local-height: var(--apkt-spacing-10);
      --local-icon-size: var(--apkt-spacing-4);
    `):this.style.cssText=`

      --local-path: var(--apkt-path-network-${this.size});
      --local-width:  var(--apkt-width-network-${this.size});
      --local-height:  var(--apkt-height-network-${this.size});
      --local-icon-size:  var(--apkt-spacing-${({sm:"4",md:"6",lg:"10"})[this.size]});
    `,(0,i.dy)`${this.templateVisual()} ${this.svgTemplate()} `}svgTemplate(){return this.round?null:this.networkImagesBySize[this.size]}templateVisual(){return this.imageSrc?(0,i.dy)`<wui-image src=${this.imageSrc} alt=${this.name}></wui-image>`:(0,i.dy)`<wui-icon size="inherit" color="default" name="networkPlaceholder"></wui-icon>`}};eg.styles=[D.ET,em],ew([(0,r.Cb)()],eg.prototype,"size",void 0),ew([(0,r.Cb)()],eg.prototype,"name",void 0),ew([(0,r.Cb)({type:Object})],eg.prototype,"networkImagesBySize",void 0),ew([(0,r.Cb)()],eg.prototype,"imageSrc",void 0),ew([(0,r.Cb)({type:Boolean})],eg.prototype,"selected",void 0),ew([(0,r.Cb)({type:Boolean})],eg.prototype,"round",void 0),eg=ew([(0,L.M)("wui-network-image")],eg);var ey=(0,W.iv)`
  :host {
    position: relative;
    display: flex;
    width: 100%;
    height: 1px;
    background-color: ${({tokens:e})=>e.theme.borderPrimary};
    justify-content: center;
    align-items: center;
  }

  :host > wui-text {
    position: absolute;
    padding: 0px 8px;
    transition: background-color ${({durations:e})=>e.lg}
      ${({easings:e})=>e["ease-out-power-2"]};
    will-change: background-color;
  }

  :host([data-bg-color='primary']) > wui-text {
    background-color: ${({tokens:e})=>e.theme.backgroundPrimary};
  }

  :host([data-bg-color='secondary']) > wui-text {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
  }
`,ef=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let eb=class extends i.oi{constructor(){super(...arguments),this.text="",this.bgColor="primary"}render(){return this.dataset.bgColor=this.bgColor,(0,i.dy)`${this.template()}`}template(){return this.text?(0,i.dy)`<wui-text variant="md-regular" color="secondary">${this.text}</wui-text>`:null}};eb.styles=[D.ET,ey],ef([(0,r.Cb)()],eb.prototype,"text",void 0),ef([(0,r.Cb)()],eb.prototype,"bgColor",void 0),eb=ef([(0,L.M)("wui-separator")],eb),o(40511);var ev=o(86988),ek=o(54090);let ex={INVALID_PAYMENT_CONFIG:"INVALID_PAYMENT_CONFIG",INVALID_RECIPIENT:"INVALID_RECIPIENT",INVALID_ASSET:"INVALID_ASSET",INVALID_AMOUNT:"INVALID_AMOUNT",UNKNOWN_ERROR:"UNKNOWN_ERROR",UNABLE_TO_INITIATE_PAYMENT:"UNABLE_TO_INITIATE_PAYMENT",INVALID_CHAIN_NAMESPACE:"INVALID_CHAIN_NAMESPACE",GENERIC_PAYMENT_ERROR:"GENERIC_PAYMENT_ERROR",UNABLE_TO_GET_EXCHANGES:"UNABLE_TO_GET_EXCHANGES",ASSET_NOT_SUPPORTED:"ASSET_NOT_SUPPORTED",UNABLE_TO_GET_PAY_URL:"UNABLE_TO_GET_PAY_URL",UNABLE_TO_GET_BUY_STATUS:"UNABLE_TO_GET_BUY_STATUS",UNABLE_TO_GET_TOKEN_BALANCES:"UNABLE_TO_GET_TOKEN_BALANCES",UNABLE_TO_GET_QUOTE:"UNABLE_TO_GET_QUOTE",UNABLE_TO_GET_QUOTE_STATUS:"UNABLE_TO_GET_QUOTE_STATUS",INVALID_RECIPIENT_ADDRESS_FOR_ASSET:"INVALID_RECIPIENT_ADDRESS_FOR_ASSET"},eC={[ex.INVALID_PAYMENT_CONFIG]:"Invalid payment configuration",[ex.INVALID_RECIPIENT]:"Invalid recipient address",[ex.INVALID_ASSET]:"Invalid asset specified",[ex.INVALID_AMOUNT]:"Invalid payment amount",[ex.INVALID_RECIPIENT_ADDRESS_FOR_ASSET]:"Invalid recipient address for the asset selected",[ex.UNKNOWN_ERROR]:"Unknown payment error occurred",[ex.UNABLE_TO_INITIATE_PAYMENT]:"Unable to initiate payment",[ex.INVALID_CHAIN_NAMESPACE]:"Invalid chain namespace",[ex.GENERIC_PAYMENT_ERROR]:"Unable to process payment",[ex.UNABLE_TO_GET_EXCHANGES]:"Unable to get exchanges",[ex.ASSET_NOT_SUPPORTED]:"Asset not supported by the selected exchange",[ex.UNABLE_TO_GET_PAY_URL]:"Unable to get payment URL",[ex.UNABLE_TO_GET_BUY_STATUS]:"Unable to get buy status",[ex.UNABLE_TO_GET_TOKEN_BALANCES]:"Unable to get token balances",[ex.UNABLE_TO_GET_QUOTE]:"Unable to get quote. Please choose a different token",[ex.UNABLE_TO_GET_QUOTE_STATUS]:"Unable to get quote status"};class eS extends Error{get message(){return eC[this.code]}constructor(e,t){super(eC[e]),this.name="AppKitPayError",this.code=e,this.details=t,Error.captureStackTrace&&Error.captureStackTrace(this,eS)}}var eT=o(39905);let eA="reown_test";var eI=o(41613),eE=o(76115);async function eP(e,t,o){if(t!==v.b.CHAIN.EVM)throw new eS(ex.INVALID_CHAIN_NAMESPACE);if(!o.fromAddress)throw new eS(ex.INVALID_PAYMENT_CONFIG,"fromAddress is required for native EVM payments.");let i="string"==typeof o.amount?parseFloat(o.amount):o.amount;if(isNaN(i))throw new eS(ex.INVALID_PAYMENT_CONFIG);let r=e.metadata?.decimals??18,a=p.ConnectionController.parseUnits(i.toString(),r);if("bigint"!=typeof a)throw new eS(ex.GENERIC_PAYMENT_ERROR);return await p.ConnectionController.sendTransaction({chainNamespace:t,to:o.recipient,address:o.fromAddress,value:a,data:"0x"})??void 0}async function e$(e,t){if(!t.fromAddress)throw new eS(ex.INVALID_PAYMENT_CONFIG,"fromAddress is required for ERC20 EVM payments.");let o=e.asset,i=t.recipient,r=Number(e.metadata.decimals),a=p.ConnectionController.parseUnits(t.amount.toString(),r);if(void 0===a)throw new eS(ex.GENERIC_PAYMENT_ERROR);return await p.ConnectionController.writeContract({fromAddress:t.fromAddress,tokenAddress:o,args:[i,a],method:"transfer",abi:eI.g.getERC20Abi(o),chainNamespace:v.b.CHAIN.EVM})??void 0}async function eN(e,t){if(e!==v.b.CHAIN.SOLANA)throw new eS(ex.INVALID_CHAIN_NAMESPACE);if(!t.fromAddress)throw new eS(ex.INVALID_PAYMENT_CONFIG,"fromAddress is required for Solana payments.");let o="string"==typeof t.amount?parseFloat(t.amount):t.amount;if(isNaN(o)||o<=0)throw new eS(ex.INVALID_PAYMENT_CONFIG,"Invalid payment amount.");try{if(!eE.O.getProvider(e))throw new eS(ex.GENERIC_PAYMENT_ERROR,"No Solana provider available.");let i=await p.ConnectionController.sendTransaction({chainNamespace:v.b.CHAIN.SOLANA,to:t.recipient,value:o,tokenMint:t.tokenMint});if(!i)throw new eS(ex.GENERIC_PAYMENT_ERROR,"Transaction failed.");return i}catch(e){if(e instanceof eS)throw e;throw new eS(ex.GENERIC_PAYMENT_ERROR,`Solana payment failed: ${e}`)}}async function eR({sourceToken:e,toToken:t,amount:o,recipient:i}){let r=p.ConnectionController.parseUnits(o,e.metadata.decimals),a=p.ConnectionController.parseUnits(o,t.metadata.decimals);return Promise.resolve({type:eX,origin:{amount:r?.toString()??"0",currency:e},destination:{amount:a?.toString()??"0",currency:t},fees:[{id:"service",label:"Service Fee",amount:"0",currency:t}],steps:[{requestId:eX,type:"deposit",deposit:{amount:r?.toString()??"0",currency:e.asset,receiver:i}}],timeInSeconds:6})}function eO(e){if(!e)return null;let t=e.steps[0];return t&&t.type===eZ?t:null}function e_(e,t=0){if(!e)return[];let o=e.steps.filter(e=>e.type===eJ),i=o.filter((e,o)=>o+1>t);return o.length>0&&o.length<3?i:[]}let eB=new eT.V({baseUrl:T.j.getApiUrl(),clientId:null});class eU extends Error{}function eD(){let{projectId:e,sdkType:t,sdkVersion:o}=n.OptionsController.state;return{projectId:e,st:t||"appkit",sv:o||"html-wagmi-4.2.2"}}async function eL(e,t){let o=function(){let e=n.OptionsController.getSnapshot().projectId;return`https://rpc.walletconnect.org/v1/json-rpc?projectId=${e}`}(),{sdkType:i,sdkVersion:r,projectId:a}=n.OptionsController.getSnapshot(),s={jsonrpc:"2.0",id:1,method:e,params:{...t||{},st:i,sv:r,projectId:a}},c=await fetch(o,{method:"POST",body:JSON.stringify(s),headers:{"Content-Type":"application/json"}}),l=await c.json();if(l.error)throw new eU(l.error.message);return l}async function eW(e){return(await eL("reown_getExchanges",e)).result}async function ez(e){return(await eL("reown_getExchangePayUrl",e)).result}async function ej(e){return(await eL("reown_getExchangeBuyStatus",e)).result}async function eF(e){let t=b.C.bigNumber(e.amount).times(10**e.toToken.metadata.decimals).toString(),{chainId:o,chainNamespace:i}=ev.u.parseCaipNetworkId(e.sourceToken.network),{chainId:r,chainNamespace:a}=ev.u.parseCaipNetworkId(e.toToken.network),n="native"===e.sourceToken.asset?(0,C.rG)(i):e.sourceToken.asset,s="native"===e.toToken.asset?(0,C.rG)(a):e.toToken.asset;return await eB.post({path:"/appkit/v1/transfers/quote",body:{user:e.address,originChainId:o.toString(),originCurrency:n,destinationChainId:r.toString(),destinationCurrency:s,recipient:e.recipient,amount:t},params:eD()})}async function eM(e){let t=ek.g.isLowerCaseMatch(e.sourceToken.network,e.toToken.network),o=ek.g.isLowerCaseMatch(e.sourceToken.asset,e.toToken.asset);return t&&o?eR(e):eF(e)}async function eq(e){return await eB.get({path:"/appkit/v1/transfers/status",params:{requestId:e.requestId,...eD()}})}async function eV(e){return await eB.get({path:`/appkit/v1/transfers/assets/exchanges/${e}`,params:eD()})}let eG=["eip155","solana"],eH={eip155:{native:{assetNamespace:"slip44",assetReference:"60"},defaultTokenNamespace:"erc20"},solana:{native:{assetNamespace:"slip44",assetReference:"501"},defaultTokenNamespace:"token"}};function eY(e,t){let{chainNamespace:o,chainId:i}=ev.u.parseCaipNetworkId(e),r=eH[o];if(!r)throw Error(`Unsupported chain namespace for CAIP-19 formatting: ${o}`);let a=r.native.assetNamespace,n=r.native.assetReference;"native"!==t&&(a=r.defaultTokenNamespace,n=t);let s=`${o}:${i}`;return`${s}/${a}:${n}`}function eK(e){let t=b.C.bigNumber(e,{safe:!0});return t.lt(.001)?"<0.001":t.round(4).toString()}let eQ="unknown",eX="direct-transfer",eZ="deposit",eJ="transaction",e0=(0,y.sj)({paymentAsset:{network:"eip155:1",asset:"0x0",metadata:{name:"0x0",symbol:"0x0",decimals:0}},recipient:"0x0",amount:0,isConfigured:!1,error:null,isPaymentInProgress:!1,exchanges:[],isLoading:!1,openInNewTab:!0,redirectUrl:void 0,payWithExchange:void 0,currentPayment:void 0,analyticsSet:!1,paymentId:void 0,choice:"pay",tokenBalances:{[v.b.CHAIN.EVM]:[],[v.b.CHAIN.SOLANA]:[]},isFetchingTokenBalances:!1,selectedPaymentAsset:null,quote:void 0,quoteStatus:"waiting",quoteError:null,isFetchingQuote:!1,selectedExchange:void 0,exchangeUrlForQuote:void 0,requestId:void 0}),e3={state:e0,subscribe:e=>(0,y.Ld)(e0,()=>e(e0)),subscribeKey:(e,t)=>(0,f.VW)(e0,e,t),async handleOpenPay(e){this.resetState(),this.setPaymentConfig(e),this.initializeAnalytics(),function(){let{chainNamespace:e}=ev.u.parseCaipNetworkId(e3.state.paymentAsset.network);if(!T.j.isAddress(e3.state.recipient,e))throw new eS(ex.INVALID_RECIPIENT_ADDRESS_FOR_ASSET,`Provide valid recipient address for namespace "${e}"`)}(),await this.prepareTokenLogo(),e0.isConfigured=!0,N.X.sendEvent({type:"track",event:"PAY_MODAL_OPEN",properties:{exchanges:e0.exchanges,configuration:{network:e0.paymentAsset.network,asset:e0.paymentAsset.asset,recipient:e0.recipient,amount:e0.amount}}}),await s.I.open({view:"Pay"})},resetState(){e0.paymentAsset={network:"eip155:1",asset:"0x0",metadata:{name:"0x0",symbol:"0x0",decimals:0}},e0.recipient="0x0",e0.amount=0,e0.isConfigured=!1,e0.error=null,e0.isPaymentInProgress=!1,e0.isLoading=!1,e0.currentPayment=void 0,e0.selectedExchange=void 0,e0.exchangeUrlForQuote=void 0,e0.requestId=void 0},resetQuoteState(){e0.quote=void 0,e0.quoteStatus="waiting",e0.quoteError=null,e0.isFetchingQuote=!1,e0.requestId=void 0},setPaymentConfig(e){if(!e.paymentAsset)throw new eS(ex.INVALID_PAYMENT_CONFIG);try{e0.choice=e.choice??"pay",e0.paymentAsset=e.paymentAsset,e0.recipient=e.recipient,e0.amount=e.amount,e0.openInNewTab=e.openInNewTab??!0,e0.redirectUrl=e.redirectUrl,e0.payWithExchange=e.payWithExchange,e0.error=null}catch(e){throw new eS(ex.INVALID_PAYMENT_CONFIG,e.message)}},setSelectedPaymentAsset(e){e0.selectedPaymentAsset=e},setSelectedExchange(e){e0.selectedExchange=e},setRequestId(e){e0.requestId=e},setPaymentInProgress(e){e0.isPaymentInProgress=e},getPaymentAsset:()=>e0.paymentAsset,getExchanges:()=>e0.exchanges,async fetchExchanges(){try{e0.isLoading=!0;let e=await eW({page:0});e0.exchanges=e.exchanges.slice(0,2)}catch(e){throw g.SnackController.showError(eC.UNABLE_TO_GET_EXCHANGES),new eS(ex.UNABLE_TO_GET_EXCHANGES)}finally{e0.isLoading=!1}},async getAvailableExchanges(e){try{let t=e?.asset&&e?.network?eY(e.network,e.asset):void 0;return await eW({page:e?.page??0,asset:t,amount:e?.amount?.toString()})}catch(e){throw new eS(ex.UNABLE_TO_GET_EXCHANGES)}},async getPayUrl(e,t,o=!1){try{let i=Number(t.amount),r=await ez({exchangeId:e,asset:eY(t.network,t.asset),amount:i.toString(),recipient:`${t.network}:${t.recipient}`});return N.X.sendEvent({type:"track",event:"PAY_EXCHANGE_SELECTED",properties:{source:"pay",exchange:{id:e},configuration:{network:t.network,asset:t.asset,recipient:t.recipient,amount:i},currentPayment:{type:"exchange",exchangeId:e},headless:o}}),o&&(this.initiatePayment(),N.X.sendEvent({type:"track",event:"PAY_INITIATED",properties:{source:"pay",paymentId:e0.paymentId||eQ,configuration:{network:t.network,asset:t.asset,recipient:t.recipient,amount:i},currentPayment:{type:"exchange",exchangeId:e}}})),r}catch(e){if(e instanceof Error&&e.message.includes("is not supported"))throw new eS(ex.ASSET_NOT_SUPPORTED);throw Error(e.message)}},async generateExchangeUrlForQuote({exchangeId:e,paymentAsset:t,amount:o,recipient:i}){let r=await ez({exchangeId:e,asset:eY(t.network,t.asset),amount:o.toString(),recipient:i});e0.exchangeSessionId=r.sessionId,e0.exchangeUrlForQuote=r.url},async openPayUrl(e,t,o=!1){try{let i=await this.getPayUrl(e.exchangeId,t,o);if(!i)throw new eS(ex.UNABLE_TO_GET_PAY_URL);let r=e.openInNewTab??!0;return T.j.openHref(i.url,r?"_blank":"_self"),i}catch(e){throw e instanceof eS?e0.error=e.message:e0.error=eC.GENERIC_PAYMENT_ERROR,new eS(ex.UNABLE_TO_GET_PAY_URL)}},async onTransfer({chainNamespace:e,fromAddress:t,toAddress:o,amount:i,paymentAsset:r}){if(e0.currentPayment={type:"wallet",status:"IN_PROGRESS"},!e0.isPaymentInProgress)try{this.initiatePayment();let a=c.R.getAllRequestedCaipNetworks().find(e=>e.caipNetworkId===r.network);if(!a)throw Error("Target network not found");let n=c.R.state.activeCaipNetwork;switch(ek.g.isLowerCaseMatch(n?.caipNetworkId,a.caipNetworkId)||await c.R.switchActiveNetwork(a),e){case v.b.CHAIN.EVM:"native"===r.asset&&(e0.currentPayment.result=await eP(r,e,{recipient:o,amount:i,fromAddress:t})),r.asset.startsWith("0x")&&(e0.currentPayment.result=await e$(r,{recipient:o,amount:i,fromAddress:t})),e0.currentPayment.status="SUCCESS";break;case v.b.CHAIN.SOLANA:e0.currentPayment.result=await eN(e,{recipient:o,amount:i,fromAddress:t,tokenMint:"native"===r.asset?void 0:r.asset}),e0.currentPayment.status="SUCCESS";break;default:throw new eS(ex.INVALID_CHAIN_NAMESPACE)}}catch(e){throw e instanceof eS?e0.error=e.message:e0.error=eC.GENERIC_PAYMENT_ERROR,e0.currentPayment.status="FAILED",g.SnackController.showError(e0.error),e}finally{e0.isPaymentInProgress=!1}},async onSendTransaction(e){try{let{namespace:t,transactionStep:o}=e;e3.initiatePayment();let i=c.R.getAllRequestedCaipNetworks().find(e=>e.caipNetworkId===e0.paymentAsset?.network);if(!i)throw Error("Target network not found");let r=c.R.state.activeCaipNetwork;if(ek.g.isLowerCaseMatch(r?.caipNetworkId,i.caipNetworkId)||await c.R.switchActiveNetwork(i),t===v.b.CHAIN.EVM){let{from:e,to:i,data:r,value:a}=o.transaction;await p.ConnectionController.sendTransaction({address:e,to:i,data:r,value:BigInt(a),chainNamespace:t})}else if(t===v.b.CHAIN.SOLANA){let{instructions:e}=o.transaction;await p.ConnectionController.writeSolanaTransaction({instructions:e})}}catch(e){throw e instanceof eS?e0.error=e.message:e0.error=eC.GENERIC_PAYMENT_ERROR,g.SnackController.showError(e0.error),e}finally{e0.isPaymentInProgress=!1}},getExchangeById:e=>e0.exchanges.find(t=>t.id===e),validatePayConfig(e){let{paymentAsset:t,recipient:o,amount:i}=e;if(!t)throw new eS(ex.INVALID_PAYMENT_CONFIG);if(!o)throw new eS(ex.INVALID_RECIPIENT);if(!t.asset)throw new eS(ex.INVALID_ASSET);if(null==i||i<=0)throw new eS(ex.INVALID_AMOUNT)},async handlePayWithExchange(e){try{e0.currentPayment={type:"exchange",exchangeId:e};let{network:t,asset:o}=e0.paymentAsset,i={network:t,asset:o,amount:e0.amount,recipient:e0.recipient},r=await this.getPayUrl(e,i);if(!r)throw new eS(ex.UNABLE_TO_INITIATE_PAYMENT);return e0.currentPayment.sessionId=r.sessionId,e0.currentPayment.status="IN_PROGRESS",e0.currentPayment.exchangeId=e,this.initiatePayment(),{url:r.url,openInNewTab:e0.openInNewTab}}catch(e){return e instanceof eS?e0.error=e.message:e0.error=eC.GENERIC_PAYMENT_ERROR,e0.isPaymentInProgress=!1,g.SnackController.showError(e0.error),null}},async getBuyStatus(e,t){try{let o=await ej({sessionId:t,exchangeId:e});return("SUCCESS"===o.status||"FAILED"===o.status)&&N.X.sendEvent({type:"track",event:"SUCCESS"===o.status?"PAY_SUCCESS":"PAY_ERROR",properties:{message:"FAILED"===o.status?T.j.parseError(e0.error):void 0,source:"pay",paymentId:e0.paymentId||eQ,configuration:{network:e0.paymentAsset.network,asset:e0.paymentAsset.asset,recipient:e0.recipient,amount:e0.amount},currentPayment:{type:"exchange",exchangeId:e0.currentPayment?.exchangeId,sessionId:e0.currentPayment?.sessionId,result:o.txHash}}}),o}catch(e){throw new eS(ex.UNABLE_TO_GET_BUY_STATUS)}},async fetchTokensFromEOA({caipAddress:e,caipNetwork:t,namespace:o}){if(!e)return[];let{address:i}=ev.u.parseCaipAddress(e),r=t;return o===v.b.CHAIN.EVM&&(r=void 0),await x.Q.getMyTokensWithBalance({address:i,caipNetwork:r})},async fetchTokensFromExchange(){if(!e0.selectedExchange)return[];let e=Object.values((await eV(e0.selectedExchange.id)).assets).flat();return await Promise.all(e.map(async e=>{let t={chainId:e.network,address:`${e.network}:${e.asset}`,symbol:e.metadata.symbol,name:e.metadata.name,iconUrl:e.metadata.logoURI||"",price:0,quantity:{numeric:"0",decimals:e.metadata.decimals.toString()}},{chainNamespace:o}=ev.u.parseCaipNetworkId(t.chainId),i=t.address;if(T.j.isCaipAddress(i)){let{address:e}=ev.u.parseCaipAddress(i);i=e}let r=await Q.f.getImageByToken(i??"",o).catch(()=>void 0);return t.iconUrl=r??"",t}))},async fetchTokens({caipAddress:e,caipNetwork:t,namespace:o}){try{e0.isFetchingTokenBalances=!0;let i=e0.selectedExchange?this.fetchTokensFromExchange():this.fetchTokensFromEOA({caipAddress:e,caipNetwork:t,namespace:o}),r=await i;e0.tokenBalances={...e0.tokenBalances,[o]:r}}catch(t){let e=t instanceof Error?t.message:"Unable to get token balances";g.SnackController.showError(e)}finally{e0.isFetchingTokenBalances=!1}},async fetchQuote({amount:e,address:t,sourceToken:o,toToken:i,recipient:r}){try{e3.resetQuoteState(),e0.isFetchingQuote=!0;let a=await eM({amount:e,address:e0.selectedExchange?void 0:t,sourceToken:o,toToken:i,recipient:r});if(e0.selectedExchange){let e=eO(a);if(e){let t=`${o.network}:${e.deposit.receiver}`,i=b.C.formatNumber(e.deposit.amount,{decimals:o.metadata.decimals??0,round:8});await e3.generateExchangeUrlForQuote({exchangeId:e0.selectedExchange.id,paymentAsset:o,amount:i.toString(),recipient:t})}}e0.quote=a}catch(t){let e=eC.UNABLE_TO_GET_QUOTE;if(t instanceof Error&&t.cause&&t.cause instanceof Response)try{let o=await t.cause.json();o.error&&"string"==typeof o.error&&(e=o.error)}catch{}throw e0.quoteError=e,g.SnackController.showError(e),new eS(ex.UNABLE_TO_GET_QUOTE)}finally{e0.isFetchingQuote=!1}},async fetchQuoteStatus({requestId:e}){try{if(e===eX){let e=e0.selectedExchange,t=e0.exchangeSessionId;if(e&&t){switch((await this.getBuyStatus(e.id,t)).status){case"IN_PROGRESS":case"UNKNOWN":default:e0.quoteStatus="waiting";break;case"SUCCESS":e0.quoteStatus="success",e0.isPaymentInProgress=!1;break;case"FAILED":e0.quoteStatus="failure",e0.isPaymentInProgress=!1}return}e0.quoteStatus="success";return}let{status:t}=await eq({requestId:e});e0.quoteStatus=t}catch{throw e0.quoteStatus="failure",new eS(ex.UNABLE_TO_GET_QUOTE_STATUS)}},initiatePayment(){e0.isPaymentInProgress=!0,e0.paymentId=crypto.randomUUID()},initializeAnalytics(){e0.analyticsSet||(e0.analyticsSet=!0,this.subscribeKey("isPaymentInProgress",e=>{if(e0.currentPayment?.status&&"UNKNOWN"!==e0.currentPayment.status){let e={IN_PROGRESS:"PAY_INITIATED",SUCCESS:"PAY_SUCCESS",FAILED:"PAY_ERROR"}[e0.currentPayment.status];N.X.sendEvent({type:"track",event:e,properties:{message:"FAILED"===e0.currentPayment.status?T.j.parseError(e0.error):void 0,source:"pay",paymentId:e0.paymentId||eQ,configuration:{network:e0.paymentAsset.network,asset:e0.paymentAsset.asset,recipient:e0.recipient,amount:e0.amount},currentPayment:{type:e0.currentPayment.type,exchangeId:e0.currentPayment.exchangeId,sessionId:e0.currentPayment.sessionId,result:e0.currentPayment.result}}})}}))},async prepareTokenLogo(){if(!e0.paymentAsset.metadata.logoURI)try{let{chainNamespace:e}=ev.u.parseCaipNetworkId(e0.paymentAsset.network),t=await Q.f.getImageByToken(e0.paymentAsset.asset,e);e0.paymentAsset.metadata.logoURI=t}catch{}}};var e1=(0,U.iv)`
  wui-separator {
    margin: var(--apkt-spacing-3) calc(var(--apkt-spacing-3) * -1) var(--apkt-spacing-2)
      calc(var(--apkt-spacing-3) * -1);
    width: calc(100% + var(--apkt-spacing-3) * 2);
  }

  .token-display {
    padding: var(--apkt-spacing-3) var(--apkt-spacing-3);
    border-radius: var(--apkt-borderRadius-5);
    background-color: var(--apkt-tokens-theme-backgroundPrimary);
    margin-top: var(--apkt-spacing-3);
    margin-bottom: var(--apkt-spacing-3);
  }

  .token-display wui-text {
    text-transform: none;
  }

  wui-loading-spinner {
    padding: var(--apkt-spacing-2);
  }

  .left-image-container {
    position: relative;
    justify-content: center;
    align-items: center;
  }

  .token-image {
    border-radius: ${({borderRadius:e})=>e.round};
    width: 40px;
    height: 40px;
  }

  .chain-image {
    position: absolute;
    width: 20px;
    height: 20px;
    bottom: -3px;
    right: -5px;
    border-radius: ${({borderRadius:e})=>e.round};
    border: 2px solid ${({tokens:e})=>e.theme.backgroundPrimary};
  }

  .payment-methods-container {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    border-top-right-radius: ${({borderRadius:e})=>e[8]};
    border-top-left-radius: ${({borderRadius:e})=>e[8]};
  }
`,e2=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let e5=class extends i.oi{constructor(){super(),this.unsubscribe=[],this.amount=e3.state.amount,this.namespace=void 0,this.paymentAsset=e3.state.paymentAsset,this.activeConnectorIds=l.ConnectorController.state.activeConnectorIds,this.caipAddress=void 0,this.exchanges=e3.state.exchanges,this.isLoading=e3.state.isLoading,this.initializeNamespace(),this.unsubscribe.push(e3.subscribeKey("amount",e=>this.amount=e)),this.unsubscribe.push(l.ConnectorController.subscribeKey("activeConnectorIds",e=>this.activeConnectorIds=e)),this.unsubscribe.push(e3.subscribeKey("exchanges",e=>this.exchanges=e)),this.unsubscribe.push(e3.subscribeKey("isLoading",e=>this.isLoading=e)),e3.fetchExchanges(),e3.setSelectedExchange(void 0)}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){return(0,i.dy)`
      <wui-flex flexDirection="column">
        ${this.paymentDetailsTemplate()} ${this.paymentMethodsTemplate()}
      </wui-flex>
    `}paymentMethodsTemplate(){return(0,i.dy)`
      <wui-flex flexDirection="column" padding="3" gap="2" class="payment-methods-container">
        ${this.payWithWalletTemplate()} ${this.templateSeparator()}
        ${this.templateExchangeOptions()}
      </wui-flex>
    `}initializeNamespace(){let e=c.R.state.activeChain;this.namespace=e,this.caipAddress=c.R.getAccountData(e)?.caipAddress,this.unsubscribe.push(c.R.subscribeChainProp("accountState",e=>{this.caipAddress=e?.caipAddress},e))}paymentDetailsTemplate(){let e=c.R.getAllRequestedCaipNetworks().find(e=>e.caipNetworkId===this.paymentAsset.network);return(0,i.dy)`
      <wui-flex
        alignItems="center"
        justifyContent="space-between"
        .padding=${["6","8","6","8"]}
        gap="2"
      >
        <wui-flex alignItems="center" gap="1">
          <wui-text variant="h1-regular" color="primary">
            ${eK(this.amount||"0")}
          </wui-text>

          <wui-flex flexDirection="column">
            <wui-text variant="h6-regular" color="secondary">
              ${this.paymentAsset.metadata.symbol||"Unknown"}
            </wui-text>
            <wui-text variant="md-medium" color="secondary"
              >on ${e?.name||"Unknown"}</wui-text
            >
          </wui-flex>
        </wui-flex>

        <wui-flex class="left-image-container">
          <wui-image
            src=${(0,a.o)(this.paymentAsset.metadata.logoURI)}
            class="token-image"
          ></wui-image>
          <wui-image
            src=${(0,a.o)(Q.f.getNetworkImage(e))}
            class="chain-image"
          ></wui-image>
        </wui-flex>
      </wui-flex>
    `}payWithWalletTemplate(){return!function(e){let{chainNamespace:t}=ev.u.parseCaipNetworkId(e);return eG.includes(t)}(this.paymentAsset.network)?(0,i.dy)``:this.caipAddress?this.connectedWalletTemplate():this.disconnectedWalletTemplate()}connectedWalletTemplate(){let{name:e,image:t}=this.getWalletProperties({namespace:this.namespace});return(0,i.dy)`
      <wui-flex flexDirection="column" gap="3">
        <wui-list-item
          type="secondary"
          boxColor="foregroundSecondary"
          @click=${this.onWalletPayment}
          .boxed=${!1}
          ?chevron=${!0}
          ?fullSize=${!1}
          ?rounded=${!0}
          data-testid="wallet-payment-option"
          imageSrc=${(0,a.o)(t)}
          imageSize="3xl"
        >
          <wui-text variant="lg-regular" color="primary">Pay with ${e}</wui-text>
        </wui-list-item>

        <wui-list-item
          type="secondary"
          icon="power"
          iconColor="error"
          @click=${this.onDisconnect}
          data-testid="disconnect-button"
          ?chevron=${!1}
          boxColor="foregroundSecondary"
        >
          <wui-text variant="lg-regular" color="secondary">Disconnect</wui-text>
        </wui-list-item>
      </wui-flex>
    `}disconnectedWalletTemplate(){return(0,i.dy)`<wui-list-item
      type="secondary"
      boxColor="foregroundSecondary"
      variant="icon"
      iconColor="default"
      iconVariant="overlay"
      icon="wallet"
      @click=${this.onWalletPayment}
      ?chevron=${!0}
      data-testid="wallet-payment-option"
    >
      <wui-text variant="lg-regular" color="primary">Pay with wallet</wui-text>
    </wui-list-item>`}templateExchangeOptions(){if(this.isLoading)return(0,i.dy)`<wui-flex justifyContent="center" alignItems="center">
        <wui-loading-spinner size="md"></wui-loading-spinner>
      </wui-flex>`;let e=this.exchanges.filter(e=>!function(e){let t=c.R.getAllRequestedCaipNetworks().find(t=>t.caipNetworkId===e.network);return!!t&&!!t.testnet}(this.paymentAsset)?e.id!==eA:e.id===eA);return 0===e.length?(0,i.dy)`<wui-flex justifyContent="center" alignItems="center">
        <wui-text variant="md-medium" color="primary">No exchanges available</wui-text>
      </wui-flex>`:e.map(e=>(0,i.dy)`
        <wui-list-item
          type="secondary"
          boxColor="foregroundSecondary"
          @click=${()=>this.onExchangePayment(e)}
          data-testid="exchange-option-${e.id}"
          ?chevron=${!0}
          imageSrc=${(0,a.o)(e.imageUrl)}
        >
          <wui-text flexGrow="1" variant="lg-regular" color="primary">
            Pay with ${e.name}
          </wui-text>
        </wui-list-item>
      `)}templateSeparator(){return(0,i.dy)`<wui-separator text="or" bgColor="secondary"></wui-separator>`}async onWalletPayment(){if(!this.namespace)throw Error("Namespace not found");this.caipAddress?u.RouterController.push("PayQuote"):(await l.ConnectorController.connect(),await s.I.open({view:"PayQuote"}))}onExchangePayment(e){e3.setSelectedExchange(e),u.RouterController.push("PayQuote")}async onDisconnect(){try{await p.ConnectionController.disconnect(),await s.I.open({view:"Pay"})}catch{console.error("Failed to disconnect"),g.SnackController.showError("Failed to disconnect")}}getWalletProperties({namespace:e}){if(!e)return{name:void 0,image:void 0};let t=this.activeConnectorIds[e];if(!t)return{name:void 0,image:void 0};let o=l.ConnectorController.getConnector({id:t,namespace:e});if(!o)return{name:void 0,image:void 0};let i=Q.f.getConnectorImage(o);return{name:o.name,image:i}}};e5.styles=e1,e2([(0,r.SB)()],e5.prototype,"amount",void 0),e2([(0,r.SB)()],e5.prototype,"namespace",void 0),e2([(0,r.SB)()],e5.prototype,"paymentAsset",void 0),e2([(0,r.SB)()],e5.prototype,"activeConnectorIds",void 0),e2([(0,r.SB)()],e5.prototype,"caipAddress",void 0),e2([(0,r.SB)()],e5.prototype,"exchanges",void 0),e2([(0,r.SB)()],e5.prototype,"isLoading",void 0),e5=e2([(0,U.Mo)("w3m-pay-view")],e5);var e4=o(89906),e6=(0,W.iv)`
  :host {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .pulse-container {
    position: relative;
    width: var(--pulse-size);
    height: var(--pulse-size);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .pulse-rings {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .pulse-ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    border: 2px solid var(--pulse-color);
    opacity: 0;
    animation: pulse var(--pulse-duration, 2s) ease-out infinite;
  }

  .pulse-content {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  @keyframes pulse {
    0% {
      transform: scale(0.5);
      opacity: var(--pulse-opacity, 0.3);
    }
    50% {
      opacity: calc(var(--pulse-opacity, 0.3) * 0.5);
    }
    100% {
      transform: scale(1.2);
      opacity: 0;
    }
  }
`,e8=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let e9={"accent-primary":W.gR.tokens.core.backgroundAccentPrimary},e7=class extends i.oi{constructor(){super(...arguments),this.rings=3,this.duration=2,this.opacity=.3,this.size="200px",this.variant="accent-primary"}render(){let e=e9[this.variant];this.style.cssText=`
      --pulse-size: ${this.size};
      --pulse-duration: ${this.duration}s;
      --pulse-color: ${e};
      --pulse-opacity: ${this.opacity};
    `;let t=Array.from({length:this.rings},(e,t)=>this.renderRing(t,this.rings));return(0,i.dy)`
      <div class="pulse-container">
        <div class="pulse-rings">${t}</div>
        <div class="pulse-content">
          <slot></slot>
        </div>
      </div>
    `}renderRing(e,t){let o=e/t*this.duration,r=`animation-delay: ${o}s;`;return(0,i.dy)`<div class="pulse-ring" style=${r}></div>`}};e7.styles=[D.ET,e6],e8([(0,r.Cb)({type:Number})],e7.prototype,"rings",void 0),e8([(0,r.Cb)({type:Number})],e7.prototype,"duration",void 0),e8([(0,r.Cb)({type:Number})],e7.prototype,"opacity",void 0),e8([(0,r.Cb)()],e7.prototype,"size",void 0),e8([(0,r.Cb)()],e7.prototype,"variant",void 0),e7=e8([(0,L.M)("wui-pulse")],e7);let te=[{id:"received",title:"Receiving funds",icon:"dollar"},{id:"processing",title:"Swapping asset",icon:"recycleHorizontal"},{id:"sending",title:"Sending asset to the recipient address",icon:"send"}],tt=["success","submitted","failure","timeout","refund"];var to=(0,U.iv)`
  :host {
    display: block;
    height: 100%;
    width: 100%;
  }

  wui-image {
    border-radius: ${({borderRadius:e})=>e.round};
  }

  .token-badge-container {
    position: absolute;
    bottom: 6px;
    left: 50%;
    transform: translateX(-50%);
    border-radius: ${({borderRadius:e})=>e[4]};
    z-index: 3;
    min-width: 105px;
  }

  .token-badge-container.loading {
    background-color: ${({tokens:e})=>e.theme.backgroundPrimary};
    border: 3px solid ${({tokens:e})=>e.theme.backgroundPrimary};
  }

  .token-badge-container.success {
    background-color: ${({tokens:e})=>e.theme.backgroundPrimary};
    border: 3px solid ${({tokens:e})=>e.theme.backgroundPrimary};
  }

  .token-image-container {
    position: relative;
  }

  .token-image {
    border-radius: ${({borderRadius:e})=>e.round};
    width: 64px;
    height: 64px;
  }

  .token-image.success {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
  }

  .token-image.error {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
  }

  .token-image.loading {
    background: ${({colors:e})=>e.accent010};
  }

  .token-image wui-icon {
    width: 32px;
    height: 32px;
  }

  .token-badge {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    border: 1px solid ${({tokens:e})=>e.theme.foregroundSecondary};
    border-radius: ${({borderRadius:e})=>e[4]};
  }

  .token-badge wui-text {
    white-space: nowrap;
  }

  .payment-lifecycle-container {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    border-top-right-radius: ${({borderRadius:e})=>e[6]};
    border-top-left-radius: ${({borderRadius:e})=>e[6]};
  }

  .payment-step-badge {
    padding: ${({spacing:e})=>e[1]} ${({spacing:e})=>e[2]};
    border-radius: ${({borderRadius:e})=>e[1]};
  }

  .payment-step-badge.loading {
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
  }

  .payment-step-badge.error {
    background-color: ${({tokens:e})=>e.core.backgroundError};
  }

  .payment-step-badge.success {
    background-color: ${({tokens:e})=>e.core.backgroundSuccess};
  }

  .step-icon-container {
    position: relative;
    height: 40px;
    width: 40px;
    border-radius: ${({borderRadius:e})=>e.round};
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
  }

  .step-icon-box {
    position: absolute;
    right: -4px;
    bottom: -1px;
    padding: 2px;
    border-radius: ${({borderRadius:e})=>e.round};
    border: 2px solid ${({tokens:e})=>e.theme.backgroundPrimary};
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
  }

  .step-icon-box.success {
    background-color: ${({tokens:e})=>e.core.backgroundSuccess};
  }
`,ti=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let tr={received:["pending","success","submitted"],processing:["success","submitted"],sending:["success","submitted"]},ta=class extends i.oi{constructor(){super(),this.unsubscribe=[],this.pollingInterval=null,this.paymentAsset=e3.state.paymentAsset,this.quoteStatus=e3.state.quoteStatus,this.quote=e3.state.quote,this.amount=e3.state.amount,this.namespace=void 0,this.caipAddress=void 0,this.profileName=null,this.activeConnectorIds=l.ConnectorController.state.activeConnectorIds,this.selectedExchange=e3.state.selectedExchange,this.initializeNamespace(),this.unsubscribe.push(e3.subscribeKey("quoteStatus",e=>this.quoteStatus=e),e3.subscribeKey("quote",e=>this.quote=e),l.ConnectorController.subscribeKey("activeConnectorIds",e=>this.activeConnectorIds=e),e3.subscribeKey("selectedExchange",e=>this.selectedExchange=e))}connectedCallback(){super.connectedCallback(),this.startPolling()}disconnectedCallback(){super.disconnectedCallback(),this.stopPolling(),this.unsubscribe.forEach(e=>e())}render(){return(0,i.dy)`
      <wui-flex flexDirection="column" .padding=${["3","0","0","0"]} gap="2">
        ${this.tokenTemplate()} ${this.paymentTemplate()} ${this.paymentLifecycleTemplate()}
      </wui-flex>
    `}tokenTemplate(){let e=eK(this.amount||"0"),t=this.paymentAsset.metadata.symbol??"Unknown",o=c.R.getAllRequestedCaipNetworks().find(e=>e.caipNetworkId===this.paymentAsset.network),r="failure"===this.quoteStatus||"timeout"===this.quoteStatus||"refund"===this.quoteStatus;return"success"===this.quoteStatus||"submitted"===this.quoteStatus?(0,i.dy)`<wui-flex alignItems="center" justifyContent="center">
        <wui-flex justifyContent="center" alignItems="center" class="token-image success">
          <wui-icon name="checkmark" color="success" size="inherit"></wui-icon>
        </wui-flex>
      </wui-flex>`:r?(0,i.dy)`<wui-flex alignItems="center" justifyContent="center">
        <wui-flex justifyContent="center" alignItems="center" class="token-image error">
          <wui-icon name="close" color="error" size="inherit"></wui-icon>
        </wui-flex>
      </wui-flex>`:(0,i.dy)`
      <wui-flex alignItems="center" justifyContent="center">
        <wui-flex class="token-image-container">
          <wui-pulse size="125px" rings="3" duration="4" opacity="0.5" variant="accent-primary">
            <wui-flex justifyContent="center" alignItems="center" class="token-image loading">
              <wui-icon name="paperPlaneTitle" color="accent-primary" size="inherit"></wui-icon>
            </wui-flex>
          </wui-pulse>

          <wui-flex
            justifyContent="center"
            alignItems="center"
            class="token-badge-container loading"
          >
            <wui-flex
              alignItems="center"
              justifyContent="center"
              gap="01"
              padding="1"
              class="token-badge"
            >
              <wui-image
                src=${(0,a.o)(Q.f.getNetworkImage(o))}
                class="chain-image"
                size="mdl"
              ></wui-image>

              <wui-text variant="lg-regular" color="primary">${e} ${t}</wui-text>
            </wui-flex>
          </wui-flex>
        </wui-flex>
      </wui-flex>
    `}paymentTemplate(){return(0,i.dy)`
      <wui-flex flexDirection="column" gap="2" .padding=${["0","6","0","6"]}>
        ${this.renderPayment()}
        <wui-separator></wui-separator>
        ${this.renderWallet()}
      </wui-flex>
    `}paymentLifecycleTemplate(){let e=this.getStepsWithStatus();return(0,i.dy)`
      <wui-flex flexDirection="column" padding="4" gap="2" class="payment-lifecycle-container">
        <wui-flex alignItems="center" justifyContent="space-between">
          <wui-text variant="md-regular" color="secondary">PAYMENT CYCLE</wui-text>

          ${this.renderPaymentCycleBadge()}
        </wui-flex>

        <wui-flex flexDirection="column" gap="5" .padding=${["2","0","2","0"]}>
          ${e.map(e=>this.renderStep(e))}
        </wui-flex>
      </wui-flex>
    `}renderPaymentCycleBadge(){let e="failure"===this.quoteStatus||"timeout"===this.quoteStatus||"refund"===this.quoteStatus,t="success"===this.quoteStatus||"submitted"===this.quoteStatus;if(e)return(0,i.dy)`
        <wui-flex
          justifyContent="center"
          alignItems="center"
          class="payment-step-badge error"
          gap="1"
        >
          <wui-icon name="close" color="error" size="xs"></wui-icon>
          <wui-text variant="sm-regular" color="error">Failed</wui-text>
        </wui-flex>
      `;if(t)return(0,i.dy)`
        <wui-flex
          justifyContent="center"
          alignItems="center"
          class="payment-step-badge success"
          gap="1"
        >
          <wui-icon name="checkmark" color="success" size="xs"></wui-icon>
          <wui-text variant="sm-regular" color="success">Completed</wui-text>
        </wui-flex>
      `;let o=this.quote?.timeInSeconds??0;return(0,i.dy)`
      <wui-flex alignItems="center" justifyContent="space-between" gap="3">
        <wui-flex
          justifyContent="center"
          alignItems="center"
          class="payment-step-badge loading"
          gap="1"
        >
          <wui-icon name="clock" color="default" size="xs"></wui-icon>
          <wui-text variant="sm-regular" color="primary">Est. ${o} sec</wui-text>
        </wui-flex>

        <wui-icon name="chevronBottom" color="default" size="xxs"></wui-icon>
      </wui-flex>
    `}renderPayment(){let e=c.R.getAllRequestedCaipNetworks().find(e=>{let t=this.quote?.origin.currency.network;if(!t)return!1;let{chainId:o}=ev.u.parseCaipNetworkId(t);return ek.g.isLowerCaseMatch(e.id.toString(),o.toString())}),t=eK(b.C.formatNumber(this.quote?.origin.amount||"0",{decimals:this.quote?.origin.currency.metadata.decimals??0}).toString()),o=this.quote?.origin.currency.metadata.symbol??"Unknown";return(0,i.dy)`
      <wui-flex
        alignItems="flex-start"
        justifyContent="space-between"
        .padding=${["3","0","3","0"]}
      >
        <wui-text variant="lg-regular" color="secondary">Payment Method</wui-text>

        <wui-flex flexDirection="column" alignItems="flex-end" gap="1">
          <wui-flex alignItems="center" gap="01">
            <wui-text variant="lg-regular" color="primary">${t}</wui-text>
            <wui-text variant="lg-regular" color="secondary">${o}</wui-text>
          </wui-flex>

          <wui-flex alignItems="center" gap="1">
            <wui-text variant="md-regular" color="secondary">on</wui-text>
            <wui-image
              src=${(0,a.o)(Q.f.getNetworkImage(e))}
              size="xs"
            ></wui-image>
            <wui-text variant="md-regular" color="secondary">${e?.name}</wui-text>
          </wui-flex>
        </wui-flex>
      </wui-flex>
    `}renderWallet(){return(0,i.dy)`
      <wui-flex
        alignItems="flex-start"
        justifyContent="space-between"
        .padding=${["3","0","3","0"]}
      >
        <wui-text variant="lg-regular" color="secondary">Wallet</wui-text>

        ${this.renderWalletText()}
      </wui-flex>
    `}renderWalletText(){let{image:e}=this.getWalletProperties({namespace:this.namespace}),{address:t}=this.caipAddress?ev.u.parseCaipAddress(this.caipAddress):{},o=this.selectedExchange?.name;return this.selectedExchange?(0,i.dy)`
        <wui-flex alignItems="center" justifyContent="flex-end" gap="1">
          <wui-text variant="lg-regular" color="primary">${o}</wui-text>
          <wui-image src=${(0,a.o)(this.selectedExchange.imageUrl)} size="mdl"></wui-image>
        </wui-flex>
      `:(0,i.dy)`
      <wui-flex alignItems="center" justifyContent="flex-end" gap="1">
        <wui-text variant="lg-regular" color="primary">
          ${U.Hg.getTruncateString({string:this.profileName||t||o||"",charsStart:this.profileName?16:4,charsEnd:this.profileName?0:6,truncate:this.profileName?"end":"middle"})}
        </wui-text>

        <wui-image src=${(0,a.o)(e)} size="mdl"></wui-image>
      </wui-flex>
    `}getStepsWithStatus(){return"failure"===this.quoteStatus||"timeout"===this.quoteStatus||"refund"===this.quoteStatus?te.map(e=>({...e,status:"failed"})):te.map(e=>{let t=(tr[e.id]??[]).includes(this.quoteStatus)?"completed":"pending";return{...e,status:t}})}renderStep({title:e,icon:t,status:o}){return(0,i.dy)`
      <wui-flex alignItems="center" gap="3">
        <wui-flex justifyContent="center" alignItems="center" class="step-icon-container">
          <wui-icon name=${t} color="default" size="mdl"></wui-icon>

          <wui-flex alignItems="center" justifyContent="center" class=${(0,e4.$)({"step-icon-box":!0,success:"completed"===o})}>
            ${this.renderStatusIndicator(o)}
          </wui-flex>
        </wui-flex>

        <wui-text variant="md-regular" color="primary">${e}</wui-text>
      </wui-flex>
    `}renderStatusIndicator(e){return"completed"===e?(0,i.dy)`<wui-icon size="sm" color="success" name="checkmark"></wui-icon>`:"failed"===e?(0,i.dy)`<wui-icon size="sm" color="error" name="close"></wui-icon>`:"pending"===e?(0,i.dy)`<wui-loading-spinner color="accent-primary" size="sm"></wui-loading-spinner>`:null}startPolling(){this.pollingInterval||(this.fetchQuoteStatus(),this.pollingInterval=setInterval(()=>{this.fetchQuoteStatus()},3e3))}stopPolling(){this.pollingInterval&&(clearInterval(this.pollingInterval),this.pollingInterval=null)}async fetchQuoteStatus(){let e=e3.state.requestId;if(!e||tt.includes(this.quoteStatus))this.stopPolling();else try{await e3.fetchQuoteStatus({requestId:e}),tt.includes(this.quoteStatus)&&this.stopPolling()}catch{this.stopPolling()}}initializeNamespace(){let e=c.R.state.activeChain;this.namespace=e,this.caipAddress=c.R.getAccountData(e)?.caipAddress,this.profileName=c.R.getAccountData(e)?.profileName??null,this.unsubscribe.push(c.R.subscribeChainProp("accountState",e=>{this.caipAddress=e?.caipAddress,this.profileName=e?.profileName??null},e))}getWalletProperties({namespace:e}){if(!e)return{name:void 0,image:void 0};let t=this.activeConnectorIds[e];if(!t)return{name:void 0,image:void 0};let o=l.ConnectorController.getConnector({id:t,namespace:e});if(!o)return{name:void 0,image:void 0};let i=Q.f.getConnectorImage(o);return{name:o.name,image:i}}};ta.styles=to,ti([(0,r.SB)()],ta.prototype,"paymentAsset",void 0),ti([(0,r.SB)()],ta.prototype,"quoteStatus",void 0),ti([(0,r.SB)()],ta.prototype,"quote",void 0),ti([(0,r.SB)()],ta.prototype,"amount",void 0),ti([(0,r.SB)()],ta.prototype,"namespace",void 0),ti([(0,r.SB)()],ta.prototype,"caipAddress",void 0),ti([(0,r.SB)()],ta.prototype,"profileName",void 0),ti([(0,r.SB)()],ta.prototype,"activeConnectorIds",void 0),ti([(0,r.SB)()],ta.prototype,"selectedExchange",void 0),ta=ti([(0,U.Mo)("w3m-pay-loading-view")],ta);var tn=o(3874),ts=(0,W.iv)`
  button {
    display: flex;
    align-items: center;
    height: 40px;
    padding: ${({spacing:e})=>e[2]};
    border-radius: ${({borderRadius:e})=>e[4]};
    column-gap: ${({spacing:e})=>e[1]};
    background-color: transparent;
    transition: background-color ${({durations:e})=>e.lg}
      ${({easings:e})=>e["ease-out-power-2"]};
    will-change: background-color;
  }

  wui-image,
  .icon-box {
    width: ${({spacing:e})=>e[6]};
    height: ${({spacing:e})=>e[6]};
    border-radius: ${({borderRadius:e})=>e[4]};
  }

  wui-text {
    flex: 1;
  }

  .icon-box {
    position: relative;
  }

  .icon-box[data-active='true'] {
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
  }

  .circle {
    position: absolute;
    left: 16px;
    top: 15px;
    width: 8px;
    height: 8px;
    background-color: ${({tokens:e})=>e.core.textSuccess};
    box-shadow: 0 0 0 2px ${({tokens:e})=>e.theme.foregroundPrimary};
    border-radius: 50%;
  }

  /* -- Hover & Active states ----------------------------------------------------------- */
  @media (hover: hover) {
    button:hover:enabled,
    button:active:enabled {
      background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    }
  }
`,tc=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let tl=class extends i.oi{constructor(){super(...arguments),this.address="",this.profileName="",this.alt="",this.imageSrc="",this.icon=void 0,this.iconSize="md",this.enableGreenCircle=!0,this.loading=!1,this.charsStart=4,this.charsEnd=6}render(){return(0,i.dy)`
      <button>
        ${this.leftImageTemplate()} ${this.textTemplate()} ${this.rightImageTemplate()}
      </button>
    `}leftImageTemplate(){let e=this.icon?(0,i.dy)`<wui-icon
          size=${(0,a.o)(this.iconSize)}
          color="default"
          name=${this.icon}
          class="icon"
        ></wui-icon>`:(0,i.dy)`<wui-image src=${this.imageSrc} alt=${this.alt}></wui-image>`;return(0,i.dy)`
      <wui-flex
        alignItems="center"
        justifyContent="center"
        class="icon-box"
        data-active=${!!this.icon}
      >
        ${e}
        ${this.enableGreenCircle?(0,i.dy)`<wui-flex class="circle"></wui-flex>`:null}
      </wui-flex>
    `}textTemplate(){return(0,i.dy)`
      <wui-text variant="lg-regular" color="primary">
        ${tn.H.getTruncateString({string:this.profileName||this.address,charsStart:this.profileName?16:this.charsStart,charsEnd:this.profileName?0:this.charsEnd,truncate:this.profileName?"end":"middle"})}
      </wui-text>
    `}rightImageTemplate(){return(0,i.dy)`<wui-icon name="chevronBottom" size="sm" color="default"></wui-icon>`}};tl.styles=[D.ET,D.ZM,ts],tc([(0,r.Cb)()],tl.prototype,"address",void 0),tc([(0,r.Cb)()],tl.prototype,"profileName",void 0),tc([(0,r.Cb)()],tl.prototype,"alt",void 0),tc([(0,r.Cb)()],tl.prototype,"imageSrc",void 0),tc([(0,r.Cb)()],tl.prototype,"icon",void 0),tc([(0,r.Cb)()],tl.prototype,"iconSize",void 0),tc([(0,r.Cb)({type:Boolean})],tl.prototype,"enableGreenCircle",void 0),tc([(0,r.Cb)({type:Boolean})],tl.prototype,"loading",void 0),tc([(0,r.Cb)({type:Number})],tl.prototype,"charsStart",void 0),tc([(0,r.Cb)({type:Number})],tl.prototype,"charsEnd",void 0),tl=tc([(0,L.M)("wui-wallet-switch")],tl),o(80843);var td=(0,i.iv)`
  :host {
    display: block;
  }
`;let tu=class extends i.oi{render(){return(0,i.dy)`
      <wui-flex flexDirection="column" gap="4">
        <wui-flex alignItems="center" justifyContent="space-between">
          <wui-text variant="md-regular" color="secondary">Pay</wui-text>
          <wui-shimmer width="60px" height="16px" borderRadius="4xs" variant="light"></wui-shimmer>
        </wui-flex>

        <wui-flex alignItems="center" justifyContent="space-between">
          <wui-text variant="md-regular" color="secondary">Network Fee</wui-text>

          <wui-flex flexDirection="column" alignItems="flex-end" gap="2">
            <wui-shimmer
              width="75px"
              height="16px"
              borderRadius="4xs"
              variant="light"
            ></wui-shimmer>

            <wui-flex alignItems="center" gap="01">
              <wui-shimmer width="14px" height="14px" rounded variant="light"></wui-shimmer>
              <wui-shimmer
                width="49px"
                height="14px"
                borderRadius="4xs"
                variant="light"
              ></wui-shimmer>
            </wui-flex>
          </wui-flex>
        </wui-flex>

        <wui-flex alignItems="center" justifyContent="space-between">
          <wui-text variant="md-regular" color="secondary">Service Fee</wui-text>
          <wui-shimmer width="75px" height="16px" borderRadius="4xs" variant="light"></wui-shimmer>
        </wui-flex>
      </wui-flex>
    `}};tu.styles=[td],tu=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n}([(0,U.Mo)("w3m-pay-fees-skeleton")],tu);var tp=(0,U.iv)`
  :host {
    display: block;
  }

  wui-image {
    border-radius: ${({borderRadius:e})=>e.round};
  }
`,th=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let tm=class extends i.oi{constructor(){super(),this.unsubscribe=[],this.quote=e3.state.quote,this.unsubscribe.push(e3.subscribeKey("quote",e=>this.quote=e))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){let e=b.C.formatNumber(this.quote?.origin.amount||"0",{decimals:this.quote?.origin.currency.metadata.decimals??0,round:6}).toString();return(0,i.dy)`
      <wui-flex flexDirection="column" gap="4">
        <wui-flex alignItems="center" justifyContent="space-between">
          <wui-text variant="md-regular" color="secondary">Pay</wui-text>
          <wui-text variant="md-regular" color="primary">
            ${e} ${this.quote?.origin.currency.metadata.symbol||"Unknown"}
          </wui-text>
        </wui-flex>

        ${this.quote&&this.quote.fees.length>0?this.quote.fees.map(e=>this.renderFee(e)):null}
      </wui-flex>
    `}renderFee(e){let t="network"===e.id,o=b.C.formatNumber(e.amount||"0",{decimals:e.currency.metadata.decimals??0,round:6}).toString();if(t){let t=c.R.getAllRequestedCaipNetworks().find(t=>ek.g.isLowerCaseMatch(t.caipNetworkId,e.currency.network));return(0,i.dy)`
        <wui-flex alignItems="center" justifyContent="space-between">
          <wui-text variant="md-regular" color="secondary">${e.label}</wui-text>

          <wui-flex flexDirection="column" alignItems="flex-end" gap="2">
            <wui-text variant="md-regular" color="primary">
              ${o} ${e.currency.metadata.symbol||"Unknown"}
            </wui-text>

            <wui-flex alignItems="center" gap="01">
              <wui-image
                src=${(0,a.o)(Q.f.getNetworkImage(t))}
                size="xs"
              ></wui-image>
              <wui-text variant="sm-regular" color="secondary">
                ${t?.name||"Unknown"}
              </wui-text>
            </wui-flex>
          </wui-flex>
        </wui-flex>
      `}return(0,i.dy)`
      <wui-flex alignItems="center" justifyContent="space-between">
        <wui-text variant="md-regular" color="secondary">${e.label}</wui-text>
        <wui-text variant="md-regular" color="primary">
          ${o} ${e.currency.metadata.symbol||"Unknown"}
        </wui-text>
      </wui-flex>
    `}};tm.styles=[tp],th([(0,r.SB)()],tm.prototype,"quote",void 0),tm=th([(0,U.Mo)("w3m-pay-fees")],tm);var tw=(0,U.iv)`
  :host {
    display: block;
    width: 100%;
  }

  .disabled-container {
    padding: ${({spacing:e})=>e[2]};
    min-height: 168px;
  }

  wui-icon {
    width: ${({spacing:e})=>e[8]};
    height: ${({spacing:e})=>e[8]};
  }

  wui-flex > wui-text {
    max-width: 273px;
  }
`,tg=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let ty=class extends i.oi{constructor(){super(),this.unsubscribe=[],this.selectedExchange=e3.state.selectedExchange,this.unsubscribe.push(e3.subscribeKey("selectedExchange",e=>this.selectedExchange=e))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){let e=!!this.selectedExchange;return(0,i.dy)`
      <wui-flex
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        gap="3"
        class="disabled-container"
      >
        <wui-icon name="coins" color="default" size="inherit"></wui-icon>

        <wui-text variant="md-regular" color="primary" align="center">
          You don't have enough funds to complete this transaction
        </wui-text>

        ${e?null:(0,i.dy)`<wui-button
              size="md"
              variant="neutral-secondary"
              @click=${this.dispatchConnectOtherWalletEvent.bind(this)}
              >Connect other wallet</wui-button
            >`}
      </wui-flex>
    `}dispatchConnectOtherWalletEvent(){this.dispatchEvent(new CustomEvent("connectOtherWallet",{detail:!0,bubbles:!0,composed:!0}))}};ty.styles=[tw],tg([(0,r.Cb)({type:Array})],ty.prototype,"selectedExchange",void 0),ty=tg([(0,U.Mo)("w3m-pay-options-empty")],ty);var tf=(0,U.iv)`
  :host {
    display: block;
    width: 100%;
  }

  .pay-options-container {
    max-height: 196px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
  }

  .pay-options-container::-webkit-scrollbar {
    display: none;
  }

  .pay-option-container {
    border-radius: ${({borderRadius:e})=>e[4]};
    padding: ${({spacing:e})=>e[3]};
    min-height: 60px;
  }

  .token-images-container {
    position: relative;
    justify-content: center;
    align-items: center;
  }

  .chain-image {
    position: absolute;
    bottom: -3px;
    right: -5px;
    border: 2px solid ${({tokens:e})=>e.theme.foregroundSecondary};
  }
`;let tb=class extends i.oi{render(){return(0,i.dy)`
      <wui-flex flexDirection="column" gap="2" class="pay-options-container">
        ${this.renderOptionEntry()} ${this.renderOptionEntry()} ${this.renderOptionEntry()}
      </wui-flex>
    `}renderOptionEntry(){return(0,i.dy)`
      <wui-flex
        alignItems="center"
        justifyContent="space-between"
        gap="2"
        class="pay-option-container"
      >
        <wui-flex alignItems="center" gap="2">
          <wui-flex class="token-images-container">
            <wui-shimmer
              width="32px"
              height="32px"
              rounded
              variant="light"
              class="token-image"
            ></wui-shimmer>
            <wui-shimmer
              width="16px"
              height="16px"
              rounded
              variant="light"
              class="chain-image"
            ></wui-shimmer>
          </wui-flex>

          <wui-flex flexDirection="column" gap="1">
            <wui-shimmer
              width="74px"
              height="16px"
              borderRadius="4xs"
              variant="light"
            ></wui-shimmer>
            <wui-shimmer
              width="46px"
              height="14px"
              borderRadius="4xs"
              variant="light"
            ></wui-shimmer>
          </wui-flex>
        </wui-flex>
      </wui-flex>
    `}};tb.styles=[tf],tb=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n}([(0,U.Mo)("w3m-pay-options-skeleton")],tb);var tv=(0,U.iv)`
  :host {
    display: block;
    width: 100%;
  }

  .pay-options-container {
    max-height: 196px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: none;
    mask-image: var(--options-mask-image);
    -webkit-mask-image: var(--options-mask-image);
  }

  .pay-options-container::-webkit-scrollbar {
    display: none;
  }

  .pay-option-container {
    cursor: pointer;
    border-radius: ${({borderRadius:e})=>e[4]};
    padding: ${({spacing:e})=>e[3]};
    transition: background-color ${({durations:e})=>e.lg}
      ${({easings:e})=>e["ease-out-power-1"]};
    will-change: background-color;
  }

  .token-images-container {
    position: relative;
    justify-content: center;
    align-items: center;
  }

  .token-image {
    border-radius: ${({borderRadius:e})=>e.round};
    width: 32px;
    height: 32px;
  }

  .chain-image {
    position: absolute;
    width: 16px;
    height: 16px;
    bottom: -3px;
    right: -5px;
    border-radius: ${({borderRadius:e})=>e.round};
    border: 2px solid ${({tokens:e})=>e.theme.backgroundPrimary};
  }

  @media (hover: hover) and (pointer: fine) {
    .pay-option-container:hover {
      background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    }
  }
`,tk=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let tx=class extends i.oi{constructor(){super(),this.unsubscribe=[],this.options=[],this.selectedPaymentAsset=null}disconnectedCallback(){this.unsubscribe.forEach(e=>e()),this.resizeObserver?.disconnect();let e=this.shadowRoot?.querySelector(".pay-options-container");e?.removeEventListener("scroll",this.handleOptionsListScroll.bind(this))}firstUpdated(){let e=this.shadowRoot?.querySelector(".pay-options-container");e&&(requestAnimationFrame(this.handleOptionsListScroll.bind(this)),e?.addEventListener("scroll",this.handleOptionsListScroll.bind(this)),this.resizeObserver=new ResizeObserver(()=>{this.handleOptionsListScroll()}),this.resizeObserver?.observe(e),this.handleOptionsListScroll())}render(){return(0,i.dy)`
      <wui-flex flexDirection="column" gap="2" class="pay-options-container">
        ${this.options.map(e=>this.payOptionTemplate(e))}
      </wui-flex>
    `}payOptionTemplate(e){let{network:t,metadata:o,asset:r,amount:n="0"}=e,s=c.R.getAllRequestedCaipNetworks().find(e=>e.caipNetworkId===t),l=`${t}:${r}`,d=`${this.selectedPaymentAsset?.network}:${this.selectedPaymentAsset?.asset}`,u=b.C.bigNumber(n,{safe:!0}),p=u.gt(0);return(0,i.dy)`
      <wui-flex
        alignItems="center"
        justifyContent="space-between"
        gap="2"
        @click=${()=>this.onSelect?.(e)}
        class="pay-option-container"
      >
        <wui-flex alignItems="center" gap="2">
          <wui-flex class="token-images-container">
            <wui-image
              src=${(0,a.o)(o.logoURI)}
              class="token-image"
              size="3xl"
            ></wui-image>
            <wui-image
              src=${(0,a.o)(Q.f.getNetworkImage(s))}
              class="chain-image"
              size="md"
            ></wui-image>
          </wui-flex>

          <wui-flex flexDirection="column" gap="1">
            <wui-text variant="lg-regular" color="primary">${o.symbol}</wui-text>
            ${p?(0,i.dy)`<wui-text variant="sm-regular" color="secondary">
                  ${u.round(6).toString()} ${o.symbol}
                </wui-text>`:null}
          </wui-flex>
        </wui-flex>

        ${l===d?(0,i.dy)`<wui-icon name="checkmark" size="md" color="success"></wui-icon>`:null}
      </wui-flex>
    `}handleOptionsListScroll(){let e=this.shadowRoot?.querySelector(".pay-options-container");e&&(e.scrollHeight>300?(e.style.setProperty("--options-mask-image",`linear-gradient(
          to bottom,
          rgba(0, 0, 0, calc(1 - var(--options-scroll--top-opacity))) 0px,
          rgba(200, 200, 200, calc(1 - var(--options-scroll--top-opacity))) 1px,
          black 50px,
          black calc(100% - 50px),
          rgba(155, 155, 155, calc(1 - var(--options-scroll--bottom-opacity))) calc(100% - 1px),
          rgba(0, 0, 0, calc(1 - var(--options-scroll--bottom-opacity))) 100%
        )`),e.style.setProperty("--options-scroll--top-opacity",U.kj.interpolate([0,50],[0,1],e.scrollTop).toString()),e.style.setProperty("--options-scroll--bottom-opacity",U.kj.interpolate([0,50],[0,1],e.scrollHeight-e.scrollTop-e.offsetHeight).toString())):(e.style.setProperty("--options-mask-image","none"),e.style.setProperty("--options-scroll--top-opacity","0"),e.style.setProperty("--options-scroll--bottom-opacity","0")))}};tx.styles=[tv],tk([(0,r.Cb)({type:Array})],tx.prototype,"options",void 0),tk([(0,r.Cb)()],tx.prototype,"selectedPaymentAsset",void 0),tk([(0,r.Cb)()],tx.prototype,"onSelect",void 0),tx=tk([(0,U.Mo)("w3m-pay-options")],tx);var tC=(0,U.iv)`
  .payment-methods-container {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    border-top-right-radius: ${({borderRadius:e})=>e[5]};
    border-top-left-radius: ${({borderRadius:e})=>e[5]};
  }

  .pay-options-container {
    background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    border-radius: ${({borderRadius:e})=>e[5]};
    padding: ${({spacing:e})=>e[1]};
  }

  w3m-tooltip-trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    max-width: fit-content;
  }

  wui-image {
    border-radius: ${({borderRadius:e})=>e.round};
  }

  w3m-pay-options.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
`,tS=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let tT={eip155:{icon:"ethereum",label:"EVM"},solana:{icon:"solana",label:"Solana"},bip122:{icon:"bitcoin",label:"Bitcoin"},ton:{icon:"ton",label:"Ton"}},tA=class extends i.oi{constructor(){super(),this.unsubscribe=[],this.profileName=null,this.paymentAsset=e3.state.paymentAsset,this.namespace=void 0,this.caipAddress=void 0,this.amount=e3.state.amount,this.recipient=e3.state.recipient,this.activeConnectorIds=l.ConnectorController.state.activeConnectorIds,this.selectedPaymentAsset=e3.state.selectedPaymentAsset,this.selectedExchange=e3.state.selectedExchange,this.isFetchingQuote=e3.state.isFetchingQuote,this.quoteError=e3.state.quoteError,this.quote=e3.state.quote,this.isFetchingTokenBalances=e3.state.isFetchingTokenBalances,this.tokenBalances=e3.state.tokenBalances,this.isPaymentInProgress=e3.state.isPaymentInProgress,this.exchangeUrlForQuote=e3.state.exchangeUrlForQuote,this.completedTransactionsCount=0,this.unsubscribe.push(e3.subscribeKey("paymentAsset",e=>this.paymentAsset=e)),this.unsubscribe.push(e3.subscribeKey("tokenBalances",e=>this.onTokenBalancesChanged(e))),this.unsubscribe.push(e3.subscribeKey("isFetchingTokenBalances",e=>this.isFetchingTokenBalances=e)),this.unsubscribe.push(l.ConnectorController.subscribeKey("activeConnectorIds",e=>this.activeConnectorIds=e)),this.unsubscribe.push(e3.subscribeKey("selectedPaymentAsset",e=>this.selectedPaymentAsset=e)),this.unsubscribe.push(e3.subscribeKey("isFetchingQuote",e=>this.isFetchingQuote=e)),this.unsubscribe.push(e3.subscribeKey("quoteError",e=>this.quoteError=e)),this.unsubscribe.push(e3.subscribeKey("quote",e=>this.quote=e)),this.unsubscribe.push(e3.subscribeKey("amount",e=>this.amount=e)),this.unsubscribe.push(e3.subscribeKey("recipient",e=>this.recipient=e)),this.unsubscribe.push(e3.subscribeKey("isPaymentInProgress",e=>this.isPaymentInProgress=e)),this.unsubscribe.push(e3.subscribeKey("selectedExchange",e=>this.selectedExchange=e)),this.unsubscribe.push(e3.subscribeKey("exchangeUrlForQuote",e=>this.exchangeUrlForQuote=e)),this.resetQuoteState(),this.initializeNamespace(),this.fetchTokens()}disconnectedCallback(){super.disconnectedCallback(),this.resetAssetsState(),this.unsubscribe.forEach(e=>e())}updated(e){super.updated(e),e.has("selectedPaymentAsset")&&this.fetchQuote()}render(){return(0,i.dy)`
      <wui-flex flexDirection="column">
        ${this.profileTemplate()}

        <wui-flex
          flexDirection="column"
          gap="4"
          class="payment-methods-container"
          .padding=${["4","4","5","4"]}
        >
          ${this.paymentOptionsViewTemplate()} ${this.amountWithFeeTemplate()}

          <wui-flex
            alignItems="center"
            justifyContent="space-between"
            .padding=${["1","0","1","0"]}
          >
            <wui-separator></wui-separator>
          </wui-flex>

          ${this.paymentActionsTemplate()}
        </wui-flex>
      </wui-flex>
    `}profileTemplate(){if(this.selectedExchange){let e=b.C.formatNumber(this.quote?.origin.amount,{decimals:this.quote?.origin.currency.metadata.decimals??0}).toString();return(0,i.dy)`
        <wui-flex
          .padding=${["4","3","4","3"]}
          alignItems="center"
          justifyContent="space-between"
          gap="2"
        >
          <wui-text variant="lg-regular" color="secondary">Paying with</wui-text>

          ${this.quote?(0,i.dy)`<wui-text variant="lg-regular" color="primary">
                ${b.C.bigNumber(e,{safe:!0}).round(6).toString()}
                ${this.quote.origin.currency.metadata.symbol}
              </wui-text>`:(0,i.dy)`<wui-shimmer width="80px" height="18px" variant="light"></wui-shimmer>`}
        </wui-flex>
      `}let e=T.j.getPlainAddress(this.caipAddress)??"",{name:t,image:o}=this.getWalletProperties({namespace:this.namespace}),{icon:r,label:n}=tT[this.namespace]??{};return(0,i.dy)`
      <wui-flex
        .padding=${["4","3","4","3"]}
        alignItems="center"
        justifyContent="space-between"
        gap="2"
      >
        <wui-wallet-switch
          profileName=${(0,a.o)(this.profileName)}
          address=${(0,a.o)(e)}
          imageSrc=${(0,a.o)(o)}
          alt=${(0,a.o)(t)}
          @click=${this.onConnectOtherWallet.bind(this)}
          data-testid="wui-wallet-switch"
        ></wui-wallet-switch>

        <wui-wallet-switch
          profileName=${(0,a.o)(n)}
          address=${(0,a.o)(e)}
          icon=${(0,a.o)(r)}
          iconSize="xs"
          .enableGreenCircle=${!1}
          alt=${(0,a.o)(n)}
          @click=${this.onConnectOtherWallet.bind(this)}
          data-testid="wui-wallet-switch"
        ></wui-wallet-switch>
      </wui-flex>
    `}initializeNamespace(){let e=c.R.state.activeChain;this.namespace=e,this.caipAddress=c.R.getAccountData(e)?.caipAddress,this.profileName=c.R.getAccountData(e)?.profileName??null,this.unsubscribe.push(c.R.subscribeChainProp("accountState",e=>this.onAccountStateChanged(e),e))}async fetchTokens(){if(this.namespace){let e;if(this.caipAddress){let{chainId:t,chainNamespace:o}=ev.u.parseCaipAddress(this.caipAddress),i=`${o}:${t}`;e=c.R.getAllRequestedCaipNetworks().find(e=>e.caipNetworkId===i)}await e3.fetchTokens({caipAddress:this.caipAddress,caipNetwork:e,namespace:this.namespace})}}fetchQuote(){if(this.amount&&this.recipient&&this.selectedPaymentAsset&&this.paymentAsset){let{address:e}=this.caipAddress?ev.u.parseCaipAddress(this.caipAddress):{};e3.fetchQuote({amount:this.amount.toString(),address:e,sourceToken:this.selectedPaymentAsset,toToken:this.paymentAsset,recipient:this.recipient})}}getWalletProperties({namespace:e}){if(!e)return{name:void 0,image:void 0};let t=this.activeConnectorIds[e];if(!t)return{name:void 0,image:void 0};let o=l.ConnectorController.getConnector({id:t,namespace:e});if(!o)return{name:void 0,image:void 0};let i=Q.f.getConnectorImage(o);return{name:o.name,image:i}}paymentOptionsViewTemplate(){return(0,i.dy)`
      <wui-flex flexDirection="column" gap="2">
        <wui-text variant="sm-regular" color="secondary">CHOOSE PAYMENT OPTION</wui-text>
        <wui-flex class="pay-options-container">${this.paymentOptionsTemplate()}</wui-flex>
      </wui-flex>
    `}paymentOptionsTemplate(){let e=this.getPaymentAssetFromTokenBalances();if(this.isFetchingTokenBalances)return(0,i.dy)`<w3m-pay-options-skeleton></w3m-pay-options-skeleton>`;if(0===e.length)return(0,i.dy)`<w3m-pay-options-empty
        @connectOtherWallet=${this.onConnectOtherWallet.bind(this)}
      ></w3m-pay-options-empty>`;let t={disabled:this.isFetchingQuote};return(0,i.dy)`<w3m-pay-options
      class=${(0,e4.$)(t)}
      .options=${e}
      .selectedPaymentAsset=${(0,a.o)(this.selectedPaymentAsset)}
      .onSelect=${this.onSelectedPaymentAssetChanged.bind(this)}
    ></w3m-pay-options>`}amountWithFeeTemplate(){return this.isFetchingQuote||!this.selectedPaymentAsset||this.quoteError?(0,i.dy)`<w3m-pay-fees-skeleton></w3m-pay-fees-skeleton>`:(0,i.dy)`<w3m-pay-fees></w3m-pay-fees>`}paymentActionsTemplate(){let e=this.isFetchingQuote||this.isFetchingTokenBalances,t=this.isFetchingQuote||this.isFetchingTokenBalances||!this.selectedPaymentAsset||!!this.quoteError,o=b.C.formatNumber(this.quote?.origin.amount??0,{decimals:this.quote?.origin.currency.metadata.decimals??0}).toString();return this.selectedExchange?e||t?(0,i.dy)`
          <wui-shimmer width="100%" height="48px" variant="light" ?rounded=${!0}></wui-shimmer>
        `:(0,i.dy)`<wui-button
        size="lg"
        fullWidth
        variant="accent-secondary"
        @click=${this.onPayWithExchange.bind(this)}
      >
        ${`Continue in ${this.selectedExchange.name}`}

        <wui-icon name="arrowRight" color="inherit" size="sm" slot="iconRight"></wui-icon>
      </wui-button>`:(0,i.dy)`
      <wui-flex alignItems="center" justifyContent="space-between">
        <wui-flex flexDirection="column" gap="1">
          <wui-text variant="md-regular" color="secondary">Order Total</wui-text>

          ${e||t?(0,i.dy)`<wui-shimmer width="58px" height="32px" variant="light"></wui-shimmer>`:(0,i.dy)`<wui-flex alignItems="center" gap="01">
                <wui-text variant="h4-regular" color="primary">${eK(o)}</wui-text>

                <wui-text variant="lg-regular" color="secondary">
                  ${this.quote?.origin.currency.metadata.symbol||"Unknown"}
                </wui-text>
              </wui-flex>`}
        </wui-flex>

        ${this.actionButtonTemplate({isLoading:e,isDisabled:t})}
      </wui-flex>
    `}actionButtonTemplate(e){let t=e_(this.quote),{isLoading:o,isDisabled:r}=e,a="Pay";return t.length>1&&0===this.completedTransactionsCount&&(a="Approve"),(0,i.dy)`
      <wui-button
        size="lg"
        variant="accent-primary"
        ?loading=${o||this.isPaymentInProgress}
        ?disabled=${r||this.isPaymentInProgress}
        @click=${()=>{t.length>0?this.onSendTransactions():this.onTransfer()}}
      >
        ${a}
        ${o?null:(0,i.dy)`<wui-icon
              name="arrowRight"
              color="inherit"
              size="sm"
              slot="iconRight"
            ></wui-icon>`}
      </wui-button>
    `}getPaymentAssetFromTokenBalances(){return this.namespace?(this.tokenBalances[this.namespace]??[]).map(e=>{try{return function(e){let t=c.R.getAllRequestedCaipNetworks().find(t=>t.caipNetworkId===e.chainId),o=e.address;if(!t)throw Error(`Target network not found for balance chainId "${e.chainId}"`);if(ek.g.isLowerCaseMatch(e.symbol,t.nativeCurrency.symbol))o="native";else if(T.j.isCaipAddress(o)){let{address:e}=ev.u.parseCaipAddress(o);o=e}else if(!o)throw Error(`Balance address not found for balance symbol "${e.symbol}"`);return{network:t.caipNetworkId,asset:o,metadata:{name:e.name,symbol:e.symbol,decimals:Number(e.quantity.decimals),logoURI:e.iconUrl},amount:e.quantity.numeric}}(e)}catch(e){return null}}).filter(e=>!!e).filter(e=>{let{chainId:t}=ev.u.parseCaipNetworkId(e.network),{chainId:o}=ev.u.parseCaipNetworkId(this.paymentAsset.network);return!!ek.g.isLowerCaseMatch(e.asset,this.paymentAsset.asset)||!this.selectedExchange||!ek.g.isLowerCaseMatch(t.toString(),o.toString())}):[]}onTokenBalancesChanged(e){this.tokenBalances=e;let[t]=this.getPaymentAssetFromTokenBalances();t&&e3.setSelectedPaymentAsset(t)}async onConnectOtherWallet(){await l.ConnectorController.connect(),await s.I.open({view:"PayQuote"})}onAccountStateChanged(e){let{address:t}=this.caipAddress?ev.u.parseCaipAddress(this.caipAddress):{};if(this.caipAddress=e?.caipAddress,this.profileName=e?.profileName??null,t){let{address:e}=this.caipAddress?ev.u.parseCaipAddress(this.caipAddress):{};e?ek.g.isLowerCaseMatch(e,t)||(this.resetAssetsState(),this.resetQuoteState(),this.fetchTokens()):s.I.close()}}onSelectedPaymentAssetChanged(e){this.isFetchingQuote||e3.setSelectedPaymentAsset(e)}async onTransfer(){let e=eO(this.quote);if(e){if(!ek.g.isLowerCaseMatch(this.selectedPaymentAsset?.asset,e.deposit.currency))throw Error("Quote asset is not the same as the selected payment asset");let t=this.selectedPaymentAsset?.amount??"0",o=b.C.formatNumber(e.deposit.amount,{decimals:this.selectedPaymentAsset?.metadata.decimals??0}).toString();if(!b.C.bigNumber(t).gte(o)){g.SnackController.showError("Insufficient funds");return}if(this.quote&&this.selectedPaymentAsset&&this.caipAddress&&this.namespace){let{address:t}=ev.u.parseCaipAddress(this.caipAddress);await e3.onTransfer({chainNamespace:this.namespace,fromAddress:t,toAddress:e.deposit.receiver,amount:o,paymentAsset:this.selectedPaymentAsset}),e3.setRequestId(e.requestId),u.RouterController.push("PayLoading")}}}async onSendTransactions(){let e=this.selectedPaymentAsset?.amount??"0",t=b.C.formatNumber(this.quote?.origin.amount??0,{decimals:this.selectedPaymentAsset?.metadata.decimals??0}).toString();if(!b.C.bigNumber(e).gte(t)){g.SnackController.showError("Insufficient funds");return}let o=e_(this.quote),[i]=e_(this.quote,this.completedTransactionsCount);i&&this.namespace&&(await e3.onSendTransaction({namespace:this.namespace,transactionStep:i}),this.completedTransactionsCount+=1,this.completedTransactionsCount===o.length&&(e3.setRequestId(i.requestId),u.RouterController.push("PayLoading")))}onPayWithExchange(){if(this.exchangeUrlForQuote){let e=T.j.returnOpenHref("","popupWindow","scrollbar=yes,width=480,height=720");if(!e)throw Error("Could not create popup window");e.location.href=this.exchangeUrlForQuote;let t=eO(this.quote);t&&e3.setRequestId(t.requestId),e3.initiatePayment(),u.RouterController.push("PayLoading")}}resetAssetsState(){e3.setSelectedPaymentAsset(null)}resetQuoteState(){e3.resetQuoteState()}};tA.styles=tC,tS([(0,r.SB)()],tA.prototype,"profileName",void 0),tS([(0,r.SB)()],tA.prototype,"paymentAsset",void 0),tS([(0,r.SB)()],tA.prototype,"namespace",void 0),tS([(0,r.SB)()],tA.prototype,"caipAddress",void 0),tS([(0,r.SB)()],tA.prototype,"amount",void 0),tS([(0,r.SB)()],tA.prototype,"recipient",void 0),tS([(0,r.SB)()],tA.prototype,"activeConnectorIds",void 0),tS([(0,r.SB)()],tA.prototype,"selectedPaymentAsset",void 0),tS([(0,r.SB)()],tA.prototype,"selectedExchange",void 0),tS([(0,r.SB)()],tA.prototype,"isFetchingQuote",void 0),tS([(0,r.SB)()],tA.prototype,"quoteError",void 0),tS([(0,r.SB)()],tA.prototype,"quote",void 0),tS([(0,r.SB)()],tA.prototype,"isFetchingTokenBalances",void 0),tS([(0,r.SB)()],tA.prototype,"tokenBalances",void 0),tS([(0,r.SB)()],tA.prototype,"isPaymentInProgress",void 0),tS([(0,r.SB)()],tA.prototype,"exchangeUrlForQuote",void 0),tS([(0,r.SB)()],tA.prototype,"completedTransactionsCount",void 0),tA=tS([(0,U.Mo)("w3m-pay-quote-view")],tA);var tI=(0,U.iv)`
  wui-image {
    border-radius: ${({borderRadius:e})=>e.round};
  }

  .transfers-badge {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    border: 1px solid ${({tokens:e})=>e.theme.foregroundSecondary};
    border-radius: ${({borderRadius:e})=>e[4]};
  }
`,tE=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let tP=class extends i.oi{constructor(){super(),this.unsubscribe=[],this.paymentAsset=e3.state.paymentAsset,this.amount=e3.state.amount,this.unsubscribe.push(e3.subscribeKey("paymentAsset",e=>{this.paymentAsset=e}),e3.subscribeKey("amount",e=>{this.amount=e}))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){let e=c.R.getAllRequestedCaipNetworks().find(e=>e.caipNetworkId===this.paymentAsset.network);return(0,i.dy)`<wui-flex
      alignItems="center"
      gap="1"
      .padding=${["1","2","1","1"]}
      class="transfers-badge"
    >
      <wui-image src=${(0,a.o)(this.paymentAsset.metadata.logoURI)} size="xl"></wui-image>
      <wui-text variant="lg-regular" color="primary">
        ${this.amount} ${this.paymentAsset.metadata.symbol}
      </wui-text>
      <wui-text variant="sm-regular" color="secondary">
        on ${e?.name??"Unknown"}
      </wui-text>
    </wui-flex>`}};tP.styles=[tI],tE([(0,r.Cb)()],tP.prototype,"paymentAsset",void 0),tE([(0,r.Cb)()],tP.prototype,"amount",void 0),tP=tE([(0,U.Mo)("w3m-pay-header")],tP);var t$=(0,U.iv)`
  :host {
    height: 60px;
  }

  :host > wui-flex {
    box-sizing: border-box;
    background-color: var(--local-header-background-color);
  }

  wui-text {
    background-color: var(--local-header-background-color);
  }

  wui-flex.w3m-header-title {
    transform: translateY(0);
    opacity: 1;
  }

  wui-flex.w3m-header-title[view-direction='prev'] {
    animation:
      slide-down-out 120ms forwards ${({easings:e})=>e["ease-out-power-2"]},
      slide-down-in 120ms forwards ${({easings:e})=>e["ease-out-power-2"]};
    animation-delay: 0ms, 200ms;
  }

  wui-flex.w3m-header-title[view-direction='next'] {
    animation:
      slide-up-out 120ms forwards ${({easings:e})=>e["ease-out-power-2"]},
      slide-up-in 120ms forwards ${({easings:e})=>e["ease-out-power-2"]};
    animation-delay: 0ms, 200ms;
  }

  wui-icon-button[data-hidden='true'] {
    opacity: 0 !important;
    pointer-events: none;
  }

  @keyframes slide-up-out {
    from {
      transform: translateY(0px);
      opacity: 1;
    }
    to {
      transform: translateY(3px);
      opacity: 0;
    }
  }

  @keyframes slide-up-in {
    from {
      transform: translateY(-3px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  @keyframes slide-down-out {
    from {
      transform: translateY(0px);
      opacity: 1;
    }
    to {
      transform: translateY(-3px);
      opacity: 0;
    }
  }

  @keyframes slide-down-in {
    from {
      transform: translateY(3px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
`,tN=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let tR=["SmartSessionList"],tO={PayWithExchange:U.gR.tokens.theme.foregroundPrimary};function t_(){let e=u.RouterController.state.data?.connector?.name,t=u.RouterController.state.data?.wallet?.name,o=u.RouterController.state.data?.network?.name,i=t??e,r=l.ConnectorController.getConnectors(),a=1===r.length&&r[0]?.id==="w3m-email",n=c.R.getAccountData()?.socialProvider;return{Connect:`Connect ${a?"Email":""} Wallet`,Create:"Create Wallet",ChooseAccountName:void 0,Account:void 0,AccountSettings:void 0,AllWallets:"All Wallets",ApproveTransaction:"Approve Transaction",BuyInProgress:"Buy",UsageExceeded:"Usage Exceeded",ConnectingExternal:i??"Connect Wallet",ConnectingWalletConnect:i??"WalletConnect",ConnectingWalletConnectBasic:"WalletConnect",ConnectingSiwe:"Sign In",Convert:"Convert",ConvertSelectToken:"Select token",ConvertPreview:"Preview Convert",Downloads:i?`Get ${i}`:"Downloads",EmailLogin:"Email Login",EmailVerifyOtp:"Confirm Email",EmailVerifyDevice:"Register Device",GetWallet:"Get a Wallet",Networks:"Choose Network",OnRampProviders:"Choose Provider",OnRampActivity:"Activity",OnRampTokenSelect:"Select Token",OnRampFiatSelect:"Select Currency",Pay:"How you pay",ProfileWallets:"Wallets",SwitchNetwork:o??"Switch Network",Transactions:"Activity",UnsupportedChain:"Switch Network",UpgradeEmailWallet:"Upgrade Your Wallet",UpdateEmailWallet:"Edit Email",UpdateEmailPrimaryOtp:"Confirm Current Email",UpdateEmailSecondaryOtp:"Confirm New Email",WhatIsABuy:"What is Buy?",RegisterAccountName:"Choose Name",RegisterAccountNameSuccess:"",WalletReceive:"Receive",WalletCompatibleNetworks:"Compatible Networks",Swap:"Swap",SwapSelectToken:"Select Token",SwapPreview:"Preview Swap",WalletSend:"Send",WalletSendPreview:"Review Send",WalletSendSelectToken:"Select Token",WalletSendConfirmed:"Confirmed",WhatIsANetwork:"What is a network?",WhatIsAWallet:"What is a Wallet?",ConnectWallets:"Connect Wallet",ConnectSocials:"All Socials",ConnectingSocial:n?n.charAt(0).toUpperCase()+n.slice(1):"Connect Social",ConnectingMultiChain:"Select Chain",ConnectingFarcaster:"Farcaster",SwitchActiveChain:"Switch Chain",SmartSessionCreated:void 0,SmartSessionList:"Smart Sessions",SIWXSignMessage:"Sign In",PayLoading:"Processing payment...",PayQuote:"Payment Quote",DataCapture:"Profile",DataCaptureOtpConfirm:"Confirm Email",FundWallet:"Fund Wallet",PayWithExchange:"Deposit from Exchange",PayWithExchangeSelectAsset:"Select Asset",SmartAccountSettings:"Smart Account Settings"}}let tB=class extends i.oi{constructor(){super(),this.unsubscribe=[],this.heading=t_()[u.RouterController.state.view],this.network=c.R.state.activeCaipNetwork,this.networkImage=Q.f.getNetworkImage(this.network),this.showBack=!1,this.prevHistoryLength=1,this.view=u.RouterController.state.view,this.viewDirection="",this.unsubscribe.push(X.W.subscribeNetworkImages(()=>{this.networkImage=Q.f.getNetworkImage(this.network)}),u.RouterController.subscribeKey("view",e=>{setTimeout(()=>{this.view=e,this.heading=t_()[e]},es.ANIMATION_DURATIONS.HeaderText),this.onViewChange(),this.onHistoryChange()}),c.R.subscribeKey("activeCaipNetwork",e=>{this.network=e,this.networkImage=Q.f.getNetworkImage(this.network)}))}disconnectCallback(){this.unsubscribe.forEach(e=>e())}render(){let e=tO[u.RouterController.state.view]??U.gR.tokens.theme.backgroundPrimary;return this.style.setProperty("--local-header-background-color",e),(0,i.dy)`
      <wui-flex
        .padding=${["0","4","0","4"]}
        justifyContent="space-between"
        alignItems="center"
      >
        ${this.leftHeaderTemplate()} ${this.titleTemplate()} ${this.rightHeaderTemplate()}
      </wui-flex>
    `}onWalletHelp(){N.X.sendEvent({type:"track",event:"CLICK_WALLET_HELP"}),u.RouterController.push("WhatIsAWallet")}async onClose(){await m.safeClose()}rightHeaderTemplate(){let e=n.OptionsController?.state?.features?.smartSessions;return"Account"===u.RouterController.state.view&&e?(0,i.dy)`<wui-flex>
      <wui-icon-button
        icon="clock"
        size="lg"
        iconSize="lg"
        type="neutral"
        variant="primary"
        @click=${()=>u.RouterController.push("SmartSessionList")}
        data-testid="w3m-header-smart-sessions"
      ></wui-icon-button>
      ${this.closeButtonTemplate()}
    </wui-flex> `:this.closeButtonTemplate()}closeButtonTemplate(){return(0,i.dy)`
      <wui-icon-button
        icon="close"
        size="lg"
        type="neutral"
        variant="primary"
        iconSize="lg"
        @click=${this.onClose.bind(this)}
        data-testid="w3m-header-close"
      ></wui-icon-button>
    `}titleTemplate(){if("PayQuote"===this.view)return(0,i.dy)`<w3m-pay-header></w3m-pay-header>`;let e=tR.includes(this.view);return(0,i.dy)`
      <wui-flex
        view-direction="${this.viewDirection}"
        class="w3m-header-title"
        alignItems="center"
        gap="2"
      >
        <wui-text
          display="inline"
          variant="lg-regular"
          color="primary"
          data-testid="w3m-header-text"
        >
          ${this.heading}
        </wui-text>
        ${e?(0,i.dy)`<wui-tag variant="accent" size="md">Beta</wui-tag>`:null}
      </wui-flex>
    `}leftHeaderTemplate(){let{view:e}=u.RouterController.state,t="Connect"===e,o=n.OptionsController.state.enableEmbedded,r=n.OptionsController.state.enableNetworkSwitch;return"Account"===e&&r?(0,i.dy)`<wui-select
        id="dynamic"
        data-testid="w3m-account-select-network"
        active-network=${(0,a.o)(this.network?.name)}
        @click=${this.onNetworks.bind(this)}
        imageSrc=${(0,a.o)(this.networkImage)}
      ></wui-select>`:this.showBack&&!("ApproveTransaction"===e||"ConnectingSiwe"===e||t&&o)?(0,i.dy)`<wui-icon-button
        data-testid="header-back"
        id="dynamic"
        icon="chevronLeft"
        size="lg"
        iconSize="lg"
        type="neutral"
        variant="primary"
        @click=${this.onGoBack.bind(this)}
      ></wui-icon-button>`:(0,i.dy)`<wui-icon-button
      data-hidden=${!t}
      id="dynamic"
      icon="helpCircle"
      size="lg"
      iconSize="lg"
      type="neutral"
      variant="primary"
      @click=${this.onWalletHelp.bind(this)}
    ></wui-icon-button>`}onNetworks(){this.isAllowedNetworkSwitch()&&(N.X.sendEvent({type:"track",event:"CLICK_NETWORKS"}),u.RouterController.push("Networks"))}isAllowedNetworkSwitch(){let e=c.R.getAllRequestedCaipNetworks(),t=!!e&&e.length>1,o=e?.find(({id:e})=>e===this.network?.id);return t||!o}onViewChange(){let{history:e}=u.RouterController.state,t=es.VIEW_DIRECTION.Next;e.length<this.prevHistoryLength&&(t=es.VIEW_DIRECTION.Prev),this.prevHistoryLength=e.length,this.viewDirection=t}async onHistoryChange(){let{history:e}=u.RouterController.state,t=this.shadowRoot?.querySelector("#dynamic");e.length>1&&!this.showBack&&t?(await t.animate([{opacity:1},{opacity:0}],{duration:200,fill:"forwards",easing:"ease"}).finished,this.showBack=!0,t.animate([{opacity:0},{opacity:1}],{duration:200,fill:"forwards",easing:"ease"})):e.length<=1&&this.showBack&&t&&(await t.animate([{opacity:1},{opacity:0}],{duration:200,fill:"forwards",easing:"ease"}).finished,this.showBack=!1,t.animate([{opacity:0},{opacity:1}],{duration:200,fill:"forwards",easing:"ease"}))}onGoBack(){u.RouterController.goBack()}};tB.styles=t$,tN([(0,r.SB)()],tB.prototype,"heading",void 0),tN([(0,r.SB)()],tB.prototype,"network",void 0),tN([(0,r.SB)()],tB.prototype,"networkImage",void 0),tN([(0,r.SB)()],tB.prototype,"showBack",void 0),tN([(0,r.SB)()],tB.prototype,"prevHistoryLength",void 0),tN([(0,r.SB)()],tB.prototype,"view",void 0),tN([(0,r.SB)()],tB.prototype,"viewDirection",void 0),tB=tN([(0,U.Mo)("w3m-header")],tB),o(21793),o(1736);var tU=(0,W.iv)`
  :host {
    display: flex;
    align-items: center;
    gap: ${({spacing:e})=>e[1]};
    padding: ${({spacing:e})=>e[2]} ${({spacing:e})=>e[3]}
      ${({spacing:e})=>e[2]} ${({spacing:e})=>e[2]};
    border-radius: ${({borderRadius:e})=>e[20]};
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
    box-shadow:
      0px 0px 8px 0px rgba(0, 0, 0, 0.1),
      inset 0 0 0 1px ${({tokens:e})=>e.theme.borderPrimary};
    max-width: 320px;
  }

  wui-icon-box {
    border-radius: ${({borderRadius:e})=>e.round} !important;
    overflow: hidden;
  }

  wui-loading-spinner {
    padding: ${({spacing:e})=>e[1]};
    background-color: ${({tokens:e})=>e.core.foregroundAccent010};
    border-radius: ${({borderRadius:e})=>e.round} !important;
  }
`,tD=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let tL=class extends i.oi{constructor(){super(...arguments),this.message="",this.variant="success"}render(){return(0,i.dy)`
      ${this.templateIcon()}
      <wui-text variant="lg-regular" color="primary" data-testid="wui-snackbar-message"
        >${this.message}</wui-text
      >
    `}templateIcon(){return"loading"===this.variant?(0,i.dy)`<wui-loading-spinner size="md" color="accent-primary"></wui-loading-spinner>`:(0,i.dy)`<wui-icon-box
      size="md"
      color=${({success:"success",error:"error",warning:"warning",info:"default"})[this.variant]}
      icon=${({success:"checkmark",error:"warning",warning:"warningCircle",info:"info"})[this.variant]}
    ></wui-icon-box>`}};tL.styles=[D.ET,tU],tD([(0,r.Cb)()],tL.prototype,"message",void 0),tD([(0,r.Cb)()],tL.prototype,"variant",void 0),tL=tD([(0,L.M)("wui-snackbar")],tL);var tW=(0,i.iv)`
  :host {
    display: block;
    position: absolute;
    opacity: 0;
    pointer-events: none;
    top: 11px;
    left: 50%;
    width: max-content;
  }
`,tz=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let tj=class extends i.oi{constructor(){super(),this.unsubscribe=[],this.timeout=void 0,this.open=g.SnackController.state.open,this.unsubscribe.push(g.SnackController.subscribeKey("open",e=>{this.open=e,this.onOpen()}))}disconnectedCallback(){clearTimeout(this.timeout),this.unsubscribe.forEach(e=>e())}render(){let{message:e,variant:t}=g.SnackController.state;return(0,i.dy)` <wui-snackbar message=${e} variant=${t}></wui-snackbar> `}onOpen(){clearTimeout(this.timeout),this.open?(this.animate([{opacity:0,transform:"translateX(-50%) scale(0.85)"},{opacity:1,transform:"translateX(-50%) scale(1)"}],{duration:150,fill:"forwards",easing:"ease"}),this.timeout&&clearTimeout(this.timeout),g.SnackController.state.autoClose&&(this.timeout=setTimeout(()=>g.SnackController.hide(),2500))):this.animate([{opacity:1,transform:"translateX(-50%) scale(1)"},{opacity:0,transform:"translateX(-50%) scale(0.85)"}],{duration:150,fill:"forwards",easing:"ease"})}};tj.styles=tW,tz([(0,r.SB)()],tj.prototype,"open",void 0),tj=tz([(0,U.Mo)("w3m-snackbar")],tj);let tF=(0,y.sj)({message:"",open:!1,triggerRect:{width:0,height:0,top:0,left:0},variant:"shade"}),tM=(0,E.P)({state:tF,subscribe:e=>(0,y.Ld)(tF,()=>e(tF)),subscribeKey:(e,t)=>(0,f.VW)(tF,e,t),showTooltip({message:e,triggerRect:t,variant:o}){tF.open=!0,tF.message=e,tF.triggerRect=t,tF.variant=o},hide(){tF.open=!1,tF.message="",tF.triggerRect={width:0,height:0,top:0,left:0}}});var tq=(0,i.iv)`
  :host {
    width: 100%;
    display: block;
  }
`,tV=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let tG=class extends i.oi{constructor(){super(),this.unsubscribe=[],this.text="",this.open=tM.state.open,this.unsubscribe.push(u.RouterController.subscribeKey("view",()=>{tM.hide()}),s.I.subscribeKey("open",e=>{e||tM.hide()}),tM.subscribeKey("open",e=>{this.open=e}))}disconnectedCallback(){this.unsubscribe.forEach(e=>e()),tM.hide()}render(){return(0,i.dy)`
      <div
        @pointermove=${this.onMouseEnter.bind(this)}
        @pointerleave=${this.onMouseLeave.bind(this)}
      >
        ${this.renderChildren()}
      </div>
    `}renderChildren(){return(0,i.dy)`<slot></slot> `}onMouseEnter(){let e=this.getBoundingClientRect();if(!this.open){let t=document.querySelector("w3m-modal"),o={width:e.width,height:e.height,left:e.left,top:e.top};if(t){let i=t.getBoundingClientRect();o.left=e.left-(window.innerWidth-i.width)/2,o.top=e.top-(window.innerHeight-i.height)/2}tM.showTooltip({message:this.text,triggerRect:o,variant:"shade"})}}onMouseLeave(e){this.contains(e.relatedTarget)||tM.hide()}};tG.styles=[tq],tV([(0,r.Cb)()],tG.prototype,"text",void 0),tV([(0,r.SB)()],tG.prototype,"open",void 0),tG=tV([(0,U.Mo)("w3m-tooltip-trigger")],tG);var tH=(0,U.iv)`
  :host {
    pointer-events: none;
  }

  :host > wui-flex {
    display: var(--w3m-tooltip-display);
    opacity: var(--w3m-tooltip-opacity);
    padding: 9px ${({spacing:e})=>e["3"]} 10px ${({spacing:e})=>e["3"]};
    border-radius: ${({borderRadius:e})=>e["3"]};
    color: ${({tokens:e})=>e.theme.backgroundPrimary};
    position: absolute;
    top: var(--w3m-tooltip-top);
    left: var(--w3m-tooltip-left);
    transform: translate(calc(-50% + var(--w3m-tooltip-parent-width)), calc(-100% - 8px));
    max-width: calc(var(--apkt-modal-width) - ${({spacing:e})=>e["5"]});
    transition: opacity ${({durations:e})=>e.lg}
      ${({easings:e})=>e["ease-out-power-2"]};
    will-change: opacity;
    opacity: 0;
    animation-duration: ${({durations:e})=>e.xl};
    animation-timing-function: ${({easings:e})=>e["ease-out-power-2"]};
    animation-name: fade-in;
    animation-fill-mode: forwards;
  }

  :host([data-variant='shade']) > wui-flex {
    background-color: ${({tokens:e})=>e.theme.foregroundPrimary};
  }

  :host([data-variant='shade']) > wui-flex > wui-text {
    color: ${({tokens:e})=>e.theme.textSecondary};
  }

  :host([data-variant='fill']) > wui-flex {
    background-color: ${({tokens:e})=>e.theme.backgroundPrimary};
    border: 1px solid ${({tokens:e})=>e.theme.borderPrimary};
  }

  wui-icon {
    position: absolute;
    width: 12px !important;
    height: 4px !important;
    color: ${({tokens:e})=>e.theme.foregroundPrimary};
  }

  wui-icon[data-placement='top'] {
    bottom: 0px;
    left: 50%;
    transform: translate(-50%, 95%);
  }

  wui-icon[data-placement='bottom'] {
    top: 0;
    left: 50%;
    transform: translate(-50%, -95%) rotate(180deg);
  }

  wui-icon[data-placement='right'] {
    top: 50%;
    left: 0;
    transform: translate(-65%, -50%) rotate(90deg);
  }

  wui-icon[data-placement='left'] {
    top: 50%;
    right: 0%;
    transform: translate(65%, -50%) rotate(270deg);
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
`,tY=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let tK=class extends i.oi{constructor(){super(),this.unsubscribe=[],this.open=tM.state.open,this.message=tM.state.message,this.triggerRect=tM.state.triggerRect,this.variant=tM.state.variant,this.unsubscribe.push(tM.subscribe(e=>{this.open=e.open,this.message=e.message,this.triggerRect=e.triggerRect,this.variant=e.variant}))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){this.dataset.variant=this.variant;let e=this.triggerRect.top,t=this.triggerRect.left;return this.style.cssText=`
    --w3m-tooltip-top: ${e}px;
    --w3m-tooltip-left: ${t}px;
    --w3m-tooltip-parent-width: ${this.triggerRect.width/2}px;
    --w3m-tooltip-display: ${this.open?"flex":"none"};
    --w3m-tooltip-opacity: ${this.open?1:0};
    `,(0,i.dy)`<wui-flex>
      <wui-icon data-placement="top" size="inherit" name="cursor"></wui-icon>
      <wui-text color="primary" variant="sm-regular">${this.message}</wui-text>
    </wui-flex>`}};tK.styles=[tH],tY([(0,r.SB)()],tK.prototype,"open",void 0),tY([(0,r.SB)()],tK.prototype,"message",void 0),tY([(0,r.SB)()],tK.prototype,"triggerRect",void 0),tY([(0,r.SB)()],tK.prototype,"variant",void 0),tK=tY([(0,U.Mo)("w3m-tooltip")],tK);let tQ={getTabsByNamespace:e=>e&&e===v.b.CHAIN.EVM?n.OptionsController.state.remoteFeatures?.activity===!1?es.ACCOUNT_TABS.filter(e=>"Activity"!==e.label):es.ACCOUNT_TABS:[],isValidReownName:e=>/^[a-zA-Z0-9]+$/gu.test(e),isValidEmail:e=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/gu.test(e),validateReownName:e=>e.replace(/\^/gu,"").toLowerCase().replace(/[^a-zA-Z0-9]/gu,""),hasFooter(){let e=u.RouterController.state.view;if(es.VIEWS_WITH_LEGAL_FOOTER.includes(e)){let{termsConditionsUrl:e,privacyPolicyUrl:t}=n.OptionsController.state,o=n.OptionsController.state.features?.legalCheckbox;return(!!e||!!t)&&!o}return es.VIEWS_WITH_DEFAULT_FOOTER.includes(e)}};o(63957);var tX=(0,U.iv)`
  :host wui-ux-by-reown {
    padding-top: 0;
  }

  :host wui-ux-by-reown.branding-only {
    padding-top: ${({spacing:e})=>e["3"]};
  }

  a {
    text-decoration: none;
    color: ${({tokens:e})=>e.core.textAccentPrimary};
    font-weight: 500;
  }
`,tZ=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let tJ=class extends i.oi{constructor(){super(),this.unsubscribe=[],this.remoteFeatures=n.OptionsController.state.remoteFeatures,this.unsubscribe.push(n.OptionsController.subscribeKey("remoteFeatures",e=>this.remoteFeatures=e))}disconnectedCallback(){this.unsubscribe.forEach(e=>e())}render(){let{termsConditionsUrl:e,privacyPolicyUrl:t}=n.OptionsController.state,o=n.OptionsController.state.features?.legalCheckbox;return(e||t)&&!o?(0,i.dy)`
      <wui-flex flexDirection="column">
        <wui-flex .padding=${["4","3","3","3"]} justifyContent="center">
          <wui-text color="secondary" variant="md-regular" align="center">
            By connecting your wallet, you agree to our <br />
            ${this.termsTemplate()} ${this.andTemplate()} ${this.privacyTemplate()}
          </wui-text>
        </wui-flex>
        ${this.reownBrandingTemplate()}
      </wui-flex>
    `:(0,i.dy)`
        <wui-flex flexDirection="column"> ${this.reownBrandingTemplate(!0)} </wui-flex>
      `}andTemplate(){let{termsConditionsUrl:e,privacyPolicyUrl:t}=n.OptionsController.state;return e&&t?"and":""}termsTemplate(){let{termsConditionsUrl:e}=n.OptionsController.state;return e?(0,i.dy)`<a href=${e} target="_blank" rel="noopener noreferrer"
      >Terms of Service</a
    >`:null}privacyTemplate(){let{privacyPolicyUrl:e}=n.OptionsController.state;return e?(0,i.dy)`<a href=${e} target="_blank" rel="noopener noreferrer"
      >Privacy Policy</a
    >`:null}reownBrandingTemplate(e=!1){return this.remoteFeatures?.reownBranding?e?(0,i.dy)`<wui-ux-by-reown class="branding-only"></wui-ux-by-reown>`:(0,i.dy)`<wui-ux-by-reown></wui-ux-by-reown>`:null}};tJ.styles=[tX],tZ([(0,r.SB)()],tJ.prototype,"remoteFeatures",void 0),tJ=tZ([(0,U.Mo)("w3m-legal-footer")],tJ),o(51437);var t0=(0,i.iv)``;let t3=class extends i.oi{render(){let{termsConditionsUrl:e,privacyPolicyUrl:t}=n.OptionsController.state;return e||t?(0,i.dy)`
      <wui-flex
        .padding=${["4","3","3","3"]}
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
        gap="3"
      >
        <wui-text color="secondary" variant="md-regular" align="center">
          We work with the best providers to give you the lowest fees and best support. More options
          coming soon!
        </wui-text>

        ${this.howDoesItWorkTemplate()}
      </wui-flex>
    `:null}howDoesItWorkTemplate(){return(0,i.dy)` <wui-link @click=${this.onWhatIsBuy.bind(this)}>
      <wui-icon size="xs" color="accent-primary" slot="iconLeft" name="helpCircle"></wui-icon>
      How does it work?
    </wui-link>`}onWhatIsBuy(){N.X.sendEvent({type:"track",event:"SELECT_WHAT_IS_A_BUY",properties:{isSmartAccount:(0,C.r9)(c.R.state.activeChain)===k.y_.ACCOUNT_TYPES.SMART_ACCOUNT}}),u.RouterController.push("WhatIsABuy")}};t3.styles=[t0],t3=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n}([(0,U.Mo)("w3m-onramp-providers-footer")],t3);var t1=(0,U.iv)`
  :host {
    display: block;
  }

  div.container {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    overflow: hidden;
    height: auto;
    display: block;
  }

  div.container[status='hide'] {
    animation: fade-out;
    animation-duration: var(--apkt-duration-dynamic);
    animation-timing-function: ${({easings:e})=>e["ease-out-power-2"]};
    animation-fill-mode: both;
    animation-delay: 0s;
  }

  div.container[status='show'] {
    animation: fade-in;
    animation-duration: var(--apkt-duration-dynamic);
    animation-timing-function: ${({easings:e})=>e["ease-out-power-2"]};
    animation-fill-mode: both;
    animation-delay: var(--apkt-duration-dynamic);
  }

  @keyframes fade-in {
    from {
      opacity: 0;
      filter: blur(6px);
    }
    to {
      opacity: 1;
      filter: blur(0px);
    }
  }

  @keyframes fade-out {
    from {
      opacity: 1;
      filter: blur(0px);
    }
    to {
      opacity: 0;
      filter: blur(6px);
    }
  }
`,t2=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let t5=class extends i.oi{constructor(){super(...arguments),this.resizeObserver=void 0,this.unsubscribe=[],this.status="hide",this.view=u.RouterController.state.view}firstUpdated(){this.status=tQ.hasFooter()?"show":"hide",this.unsubscribe.push(u.RouterController.subscribeKey("view",e=>{this.view=e,this.status=tQ.hasFooter()?"show":"hide","hide"===this.status&&document.documentElement.style.setProperty("--apkt-footer-height","0px")})),this.resizeObserver=new ResizeObserver(e=>{for(let t of e)if(t.target===this.getWrapper()){let e=`${t.contentRect.height}px`;document.documentElement.style.setProperty("--apkt-footer-height",e)}}),this.resizeObserver.observe(this.getWrapper())}render(){return(0,i.dy)`
      <div class="container" status=${this.status}>${this.templatePageContainer()}</div>
    `}templatePageContainer(){return tQ.hasFooter()?(0,i.dy)` ${this.templateFooter()}`:null}templateFooter(){switch(this.view){case"Networks":return this.templateNetworksFooter();case"Connect":case"ConnectWallets":case"OnRampFiatSelect":case"OnRampTokenSelect":return(0,i.dy)`<w3m-legal-footer></w3m-legal-footer>`;case"OnRampProviders":return(0,i.dy)`<w3m-onramp-providers-footer></w3m-onramp-providers-footer>`;default:return null}}templateNetworksFooter(){return(0,i.dy)` <wui-flex
      class="footer-in"
      padding="3"
      flexDirection="column"
      gap="3"
      alignItems="center"
    >
      <wui-text variant="md-regular" color="secondary" align="center">
        Your connected wallet may not support some of the networks available for this dApp
      </wui-text>
      <wui-link @click=${this.onNetworkHelp.bind(this)}>
        <wui-icon size="sm" color="accent-primary" slot="iconLeft" name="helpCircle"></wui-icon>
        What is a network
      </wui-link>
    </wui-flex>`}onNetworkHelp(){N.X.sendEvent({type:"track",event:"CLICK_NETWORK_HELP"}),u.RouterController.push("WhatIsANetwork")}getWrapper(){return this.shadowRoot?.querySelector("div.container")}};t5.styles=[t1],t2([(0,r.SB)()],t5.prototype,"status",void 0),t2([(0,r.SB)()],t5.prototype,"view",void 0),t5=t2([(0,U.Mo)("w3m-footer")],t5);var t4=(0,U.iv)`
  :host {
    display: block;
    width: inherit;
  }
`,t6=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let t8=class extends i.oi{constructor(){super(),this.unsubscribe=[],this.viewState=u.RouterController.state.view,this.history=u.RouterController.state.history.join(","),this.unsubscribe.push(u.RouterController.subscribeKey("view",()=>{this.history=u.RouterController.state.history.join(","),document.documentElement.style.setProperty("--apkt-duration-dynamic","var(--apkt-durations-lg)")}))}disconnectedCallback(){this.unsubscribe.forEach(e=>e()),document.documentElement.style.setProperty("--apkt-duration-dynamic","0s")}render(){return(0,i.dy)`${this.templatePageContainer()}`}templatePageContainer(){return(0,i.dy)`<w3m-router-container
      history=${this.history}
      .setView=${()=>{this.viewState=u.RouterController.state.view}}
    >
      ${this.viewTemplate(this.viewState)}
    </w3m-router-container>`}viewTemplate(e){switch(e){case"AccountSettings":return(0,i.dy)`<w3m-account-settings-view></w3m-account-settings-view>`;case"Account":return(0,i.dy)`<w3m-account-view></w3m-account-view>`;case"AllWallets":return(0,i.dy)`<w3m-all-wallets-view></w3m-all-wallets-view>`;case"ApproveTransaction":return(0,i.dy)`<w3m-approve-transaction-view></w3m-approve-transaction-view>`;case"BuyInProgress":return(0,i.dy)`<w3m-buy-in-progress-view></w3m-buy-in-progress-view>`;case"ChooseAccountName":return(0,i.dy)`<w3m-choose-account-name-view></w3m-choose-account-name-view>`;case"Connect":default:return(0,i.dy)`<w3m-connect-view></w3m-connect-view>`;case"Create":return(0,i.dy)`<w3m-connect-view walletGuide="explore"></w3m-connect-view>`;case"ConnectingWalletConnect":return(0,i.dy)`<w3m-connecting-wc-view></w3m-connecting-wc-view>`;case"ConnectingWalletConnectBasic":return(0,i.dy)`<w3m-connecting-wc-basic-view></w3m-connecting-wc-basic-view>`;case"ConnectingExternal":return(0,i.dy)`<w3m-connecting-external-view></w3m-connecting-external-view>`;case"ConnectingSiwe":return(0,i.dy)`<w3m-connecting-siwe-view></w3m-connecting-siwe-view>`;case"ConnectWallets":return(0,i.dy)`<w3m-connect-wallets-view></w3m-connect-wallets-view>`;case"ConnectSocials":return(0,i.dy)`<w3m-connect-socials-view></w3m-connect-socials-view>`;case"ConnectingSocial":return(0,i.dy)`<w3m-connecting-social-view></w3m-connecting-social-view>`;case"DataCapture":return(0,i.dy)`<w3m-data-capture-view></w3m-data-capture-view>`;case"DataCaptureOtpConfirm":return(0,i.dy)`<w3m-data-capture-otp-confirm-view></w3m-data-capture-otp-confirm-view>`;case"Downloads":return(0,i.dy)`<w3m-downloads-view></w3m-downloads-view>`;case"EmailLogin":return(0,i.dy)`<w3m-email-login-view></w3m-email-login-view>`;case"EmailVerifyOtp":return(0,i.dy)`<w3m-email-verify-otp-view></w3m-email-verify-otp-view>`;case"EmailVerifyDevice":return(0,i.dy)`<w3m-email-verify-device-view></w3m-email-verify-device-view>`;case"GetWallet":return(0,i.dy)`<w3m-get-wallet-view></w3m-get-wallet-view>`;case"Networks":return(0,i.dy)`<w3m-networks-view></w3m-networks-view>`;case"SwitchNetwork":return(0,i.dy)`<w3m-network-switch-view></w3m-network-switch-view>`;case"ProfileWallets":return(0,i.dy)`<w3m-profile-wallets-view></w3m-profile-wallets-view>`;case"Transactions":return(0,i.dy)`<w3m-transactions-view></w3m-transactions-view>`;case"OnRampProviders":return(0,i.dy)`<w3m-onramp-providers-view></w3m-onramp-providers-view>`;case"OnRampTokenSelect":return(0,i.dy)`<w3m-onramp-token-select-view></w3m-onramp-token-select-view>`;case"OnRampFiatSelect":return(0,i.dy)`<w3m-onramp-fiat-select-view></w3m-onramp-fiat-select-view>`;case"UpgradeEmailWallet":return(0,i.dy)`<w3m-upgrade-wallet-view></w3m-upgrade-wallet-view>`;case"UpdateEmailWallet":return(0,i.dy)`<w3m-update-email-wallet-view></w3m-update-email-wallet-view>`;case"UpdateEmailPrimaryOtp":return(0,i.dy)`<w3m-update-email-primary-otp-view></w3m-update-email-primary-otp-view>`;case"UpdateEmailSecondaryOtp":return(0,i.dy)`<w3m-update-email-secondary-otp-view></w3m-update-email-secondary-otp-view>`;case"UnsupportedChain":return(0,i.dy)`<w3m-unsupported-chain-view></w3m-unsupported-chain-view>`;case"Swap":return(0,i.dy)`<w3m-swap-view></w3m-swap-view>`;case"SwapSelectToken":return(0,i.dy)`<w3m-swap-select-token-view></w3m-swap-select-token-view>`;case"SwapPreview":return(0,i.dy)`<w3m-swap-preview-view></w3m-swap-preview-view>`;case"WalletSend":return(0,i.dy)`<w3m-wallet-send-view></w3m-wallet-send-view>`;case"WalletSendSelectToken":return(0,i.dy)`<w3m-wallet-send-select-token-view></w3m-wallet-send-select-token-view>`;case"WalletSendPreview":return(0,i.dy)`<w3m-wallet-send-preview-view></w3m-wallet-send-preview-view>`;case"WalletSendConfirmed":return(0,i.dy)`<w3m-send-confirmed-view></w3m-send-confirmed-view>`;case"WhatIsABuy":return(0,i.dy)`<w3m-what-is-a-buy-view></w3m-what-is-a-buy-view>`;case"WalletReceive":return(0,i.dy)`<w3m-wallet-receive-view></w3m-wallet-receive-view>`;case"WalletCompatibleNetworks":return(0,i.dy)`<w3m-wallet-compatible-networks-view></w3m-wallet-compatible-networks-view>`;case"WhatIsAWallet":return(0,i.dy)`<w3m-what-is-a-wallet-view></w3m-what-is-a-wallet-view>`;case"ConnectingMultiChain":return(0,i.dy)`<w3m-connecting-multi-chain-view></w3m-connecting-multi-chain-view>`;case"WhatIsANetwork":return(0,i.dy)`<w3m-what-is-a-network-view></w3m-what-is-a-network-view>`;case"ConnectingFarcaster":return(0,i.dy)`<w3m-connecting-farcaster-view></w3m-connecting-farcaster-view>`;case"SwitchActiveChain":return(0,i.dy)`<w3m-switch-active-chain-view></w3m-switch-active-chain-view>`;case"RegisterAccountName":return(0,i.dy)`<w3m-register-account-name-view></w3m-register-account-name-view>`;case"RegisterAccountNameSuccess":return(0,i.dy)`<w3m-register-account-name-success-view></w3m-register-account-name-success-view>`;case"SmartSessionCreated":return(0,i.dy)`<w3m-smart-session-created-view></w3m-smart-session-created-view>`;case"SmartSessionList":return(0,i.dy)`<w3m-smart-session-list-view></w3m-smart-session-list-view>`;case"SIWXSignMessage":return(0,i.dy)`<w3m-siwx-sign-message-view></w3m-siwx-sign-message-view>`;case"Pay":return(0,i.dy)`<w3m-pay-view></w3m-pay-view>`;case"PayLoading":return(0,i.dy)`<w3m-pay-loading-view></w3m-pay-loading-view>`;case"PayQuote":return(0,i.dy)`<w3m-pay-quote-view></w3m-pay-quote-view>`;case"FundWallet":return(0,i.dy)`<w3m-fund-wallet-view></w3m-fund-wallet-view>`;case"PayWithExchange":return(0,i.dy)`<w3m-deposit-from-exchange-view></w3m-deposit-from-exchange-view>`;case"PayWithExchangeSelectAsset":return(0,i.dy)`<w3m-deposit-from-exchange-select-asset-view></w3m-deposit-from-exchange-select-asset-view>`;case"UsageExceeded":return(0,i.dy)`<w3m-usage-exceeded-view></w3m-usage-exceeded-view>`;case"SmartAccountSettings":return(0,i.dy)`<w3m-smart-account-settings-view></w3m-smart-account-settings-view>`}}};t8.styles=[t4],t6([(0,r.SB)()],t8.prototype,"viewState",void 0),t6([(0,r.SB)()],t8.prototype,"history",void 0),t8=t6([(0,U.Mo)("w3m-router")],t8);var t9=(0,U.iv)`
  :host {
    z-index: ${({tokens:e})=>e.core.zIndex};
    display: block;
    backface-visibility: hidden;
    will-change: opacity;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
    opacity: 0;
    background-color: ${({tokens:e})=>e.theme.overlay};
    backdrop-filter: blur(0px);
    transition:
      opacity ${({durations:e})=>e.lg} ${({easings:e})=>e["ease-out-power-2"]},
      backdrop-filter ${({durations:e})=>e.lg}
        ${({easings:e})=>e["ease-out-power-2"]};
    will-change: opacity;
  }

  :host(.open) {
    opacity: 1;
    backdrop-filter: blur(8px);
  }

  :host(.appkit-modal) {
    position: relative;
    pointer-events: unset;
    background: none;
    width: 100%;
    opacity: 1;
  }

  wui-card {
    max-width: var(--apkt-modal-width);
    width: 100%;
    position: relative;
    outline: none;
    transform: translateY(4px);
    box-shadow: 0 2px 8px 0 rgba(0, 0, 0, 0.05);
    transition:
      transform ${({durations:e})=>e.lg}
        ${({easings:e})=>e["ease-out-power-2"]},
      border-radius ${({durations:e})=>e.lg}
        ${({easings:e})=>e["ease-out-power-1"]},
      background-color ${({durations:e})=>e.lg}
        ${({easings:e})=>e["ease-out-power-1"]},
      box-shadow ${({durations:e})=>e.lg}
        ${({easings:e})=>e["ease-out-power-1"]};
    will-change: border-radius, background-color, transform, box-shadow;
    background-color: ${({tokens:e})=>e.theme.backgroundPrimary};
    padding: var(--local-modal-padding);
    box-sizing: border-box;
  }

  :host(.open) wui-card {
    transform: translateY(0px);
  }

  wui-card::before {
    z-index: 1;
    pointer-events: none;
    content: '';
    position: absolute;
    inset: 0;
    border-radius: clamp(0px, var(--apkt-borderRadius-8), 44px);
    transition: box-shadow ${({durations:e})=>e.lg}
      ${({easings:e})=>e["ease-out-power-2"]};
    transition-delay: ${({durations:e})=>e.md};
    will-change: box-shadow;
  }

  :host([data-mobile-fullscreen='true']) wui-card::before {
    border-radius: 0px;
  }

  :host([data-border='true']) wui-card::before {
    box-shadow: inset 0px 0px 0px 4px ${({tokens:e})=>e.theme.foregroundSecondary};
  }

  :host([data-border='false']) wui-card::before {
    box-shadow: inset 0px 0px 0px 1px ${({tokens:e})=>e.theme.borderPrimaryDark};
  }

  :host([data-border='true']) wui-card {
    animation:
      fade-in ${({durations:e})=>e.lg} ${({easings:e})=>e["ease-out-power-2"]},
      card-background-border var(--apkt-duration-dynamic)
        ${({easings:e})=>e["ease-out-power-2"]};
    animation-fill-mode: backwards, both;
    animation-delay: var(--apkt-duration-dynamic);
  }

  :host([data-border='false']) wui-card {
    animation:
      fade-in ${({durations:e})=>e.lg} ${({easings:e})=>e["ease-out-power-2"]},
      card-background-default var(--apkt-duration-dynamic)
        ${({easings:e})=>e["ease-out-power-2"]};
    animation-fill-mode: backwards, both;
    animation-delay: 0s;
  }

  :host(.appkit-modal) wui-card {
    max-width: var(--apkt-modal-width);
  }

  wui-card[shake='true'] {
    animation:
      fade-in ${({durations:e})=>e.lg} ${({easings:e})=>e["ease-out-power-2"]},
      w3m-shake ${({durations:e})=>e.xl}
        ${({easings:e})=>e["ease-out-power-2"]};
  }

  wui-flex {
    overflow-x: hidden;
    overflow-y: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
  }

  @media (max-height: 700px) and (min-width: 431px) {
    wui-flex {
      align-items: flex-start;
    }

    wui-card {
      margin: var(--apkt-spacing-6) 0px;
    }
  }

  @media (max-width: 430px) {
    :host([data-mobile-fullscreen='true']) {
      height: 100dvh;
    }
    :host([data-mobile-fullscreen='true']) wui-flex {
      align-items: stretch;
    }
    :host([data-mobile-fullscreen='true']) wui-card {
      max-width: 100%;
      height: 100%;
      border-radius: 0;
      border: none;
    }
    :host(:not([data-mobile-fullscreen='true'])) wui-flex {
      align-items: flex-end;
    }

    :host(:not([data-mobile-fullscreen='true'])) wui-card {
      max-width: 100%;
      border-bottom: none;
    }

    :host(:not([data-mobile-fullscreen='true'])) wui-card[data-embedded='true'] {
      border-bottom-left-radius: clamp(0px, var(--apkt-borderRadius-8), 44px);
      border-bottom-right-radius: clamp(0px, var(--apkt-borderRadius-8), 44px);
    }

    :host(:not([data-mobile-fullscreen='true'])) wui-card:not([data-embedded='true']) {
      border-bottom-left-radius: 0px;
      border-bottom-right-radius: 0px;
    }

    wui-card[shake='true'] {
      animation: w3m-shake 0.5s ${({easings:e})=>e["ease-out-power-2"]};
    }
  }

  @keyframes fade-in {
    0% {
      transform: scale(0.99) translateY(4px);
    }
    100% {
      transform: scale(1) translateY(0);
    }
  }

  @keyframes w3m-shake {
    0% {
      transform: scale(1) rotate(0deg);
    }
    20% {
      transform: scale(1) rotate(-1deg);
    }
    40% {
      transform: scale(1) rotate(1.5deg);
    }
    60% {
      transform: scale(1) rotate(-1.5deg);
    }
    80% {
      transform: scale(1) rotate(1deg);
    }
    100% {
      transform: scale(1) rotate(0deg);
    }
  }

  @keyframes card-background-border {
    from {
      background-color: ${({tokens:e})=>e.theme.backgroundPrimary};
    }
    to {
      background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    }
  }

  @keyframes card-background-default {
    from {
      background-color: ${({tokens:e})=>e.theme.foregroundSecondary};
    }
    to {
      background-color: ${({tokens:e})=>e.theme.backgroundPrimary};
    }
  }
`,t7=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let oe="scroll-lock",ot={PayWithExchange:"0",PayWithExchangeSelectAsset:"0",Pay:"0",PayQuote:"0",PayLoading:"0"};class oo extends i.oi{constructor(){super(),this.unsubscribe=[],this.abortController=void 0,this.hasPrefetched=!1,this.enableEmbedded=n.OptionsController.state.enableEmbedded,this.open=s.I.state.open,this.caipAddress=c.R.state.activeCaipAddress,this.caipNetwork=c.R.state.activeCaipNetwork,this.shake=s.I.state.shake,this.filterByNamespace=l.ConnectorController.state.filterByNamespace,this.padding=U.gR.spacing[1],this.mobileFullScreen=n.OptionsController.state.enableMobileFullScreen,this.initializeTheming(),d.ApiController.prefetchAnalyticsConfig(),this.unsubscribe.push(s.I.subscribeKey("open",e=>e?this.onOpen():this.onClose()),s.I.subscribeKey("shake",e=>this.shake=e),c.R.subscribeKey("activeCaipNetwork",e=>this.onNewNetwork(e)),c.R.subscribeKey("activeCaipAddress",e=>this.onNewAddress(e)),n.OptionsController.subscribeKey("enableEmbedded",e=>this.enableEmbedded=e),l.ConnectorController.subscribeKey("filterByNamespace",e=>{this.filterByNamespace===e||c.R.getAccountData(e)?.caipAddress||(d.ApiController.fetchRecommendedWallets(),this.filterByNamespace=e)}),u.RouterController.subscribeKey("view",()=>{this.dataset.border=tQ.hasFooter()?"true":"false",this.padding=ot[u.RouterController.state.view]??U.gR.spacing[1]}))}firstUpdated(){if(this.dataset.border=tQ.hasFooter()?"true":"false",this.mobileFullScreen&&this.setAttribute("data-mobile-fullscreen","true"),this.caipAddress){if(this.enableEmbedded){s.I.close(),this.prefetch();return}this.onNewAddress(this.caipAddress)}this.open&&this.onOpen(),this.enableEmbedded&&this.prefetch()}disconnectedCallback(){this.unsubscribe.forEach(e=>e()),this.onRemoveKeyboardListener()}render(){return(this.style.setProperty("--local-modal-padding",this.padding),this.enableEmbedded)?(0,i.dy)`${this.contentTemplate()}
        <w3m-tooltip></w3m-tooltip> `:this.open?(0,i.dy)`
          <wui-flex @click=${this.onOverlayClick.bind(this)} data-testid="w3m-modal-overlay">
            ${this.contentTemplate()}
          </wui-flex>
          <w3m-tooltip></w3m-tooltip>
        `:null}contentTemplate(){return(0,i.dy)` <wui-card
      shake="${this.shake}"
      data-embedded="${(0,a.o)(this.enableEmbedded)}"
      role="alertdialog"
      aria-modal="true"
      tabindex="0"
      data-testid="w3m-modal-card"
    >
      <w3m-header></w3m-header>
      <w3m-router></w3m-router>
      <w3m-footer></w3m-footer>
      <w3m-snackbar></w3m-snackbar>
      <w3m-alertbar></w3m-alertbar>
    </wui-card>`}async onOverlayClick(e){e.target!==e.currentTarget||this.mobileFullScreen||await this.handleClose()}async handleClose(){await m.safeClose()}initializeTheming(){let{themeVariables:e,themeMode:t}=w.ThemeController.state,o=U.Hg.getColorTheme(t);(0,U.n)(e,o)}onClose(){this.open=!1,this.classList.remove("open"),this.onScrollUnlock(),g.SnackController.hide(),this.onRemoveKeyboardListener()}onOpen(){this.open=!0,this.classList.add("open"),this.onScrollLock(),this.onAddKeyboardListener()}onScrollLock(){let e=document.createElement("style");e.dataset.w3m=oe,e.textContent=`
      body {
        touch-action: none;
        overflow: hidden;
        overscroll-behavior: contain;
      }
      w3m-modal {
        pointer-events: auto;
      }
    `,document.head.appendChild(e)}onScrollUnlock(){let e=document.head.querySelector(`style[data-w3m="${oe}"]`);e&&e.remove()}onAddKeyboardListener(){this.abortController=new AbortController;let e=this.shadowRoot?.querySelector("wui-card");e?.focus(),window.addEventListener("keydown",t=>{if("Escape"===t.key)this.handleClose();else if("Tab"===t.key){let{tagName:o}=t.target;!o||o.includes("W3M-")||o.includes("WUI-")||e?.focus()}},this.abortController)}onRemoveKeyboardListener(){this.abortController?.abort(),this.abortController=void 0}async onNewAddress(e){let t=c.R.state.isSwitchingNamespace,o="ProfileWallets"===u.RouterController.state.view;e||t||o||s.I.close(),await h.w.initializeIfEnabled(e),this.caipAddress=e,c.R.setIsSwitchingNamespace(!1)}onNewNetwork(e){let t=this.caipNetwork,o=t?.caipNetworkId?.toString(),i=e?.caipNetworkId?.toString(),r="UnsupportedChain"===u.RouterController.state.view,a=s.I.state.open,n=!1;this.enableEmbedded&&"SwitchNetwork"===u.RouterController.state.view&&(n=!0),o!==i&&B.resetState(),a&&r&&(n=!0),n&&"SIWXSignMessage"!==u.RouterController.state.view&&u.RouterController.goBack(),this.caipNetwork=e}prefetch(){this.hasPrefetched||(d.ApiController.prefetch(),d.ApiController.fetchWalletsByPage({page:1}),this.hasPrefetched=!0)}}oo.styles=t9,t7([(0,r.Cb)({type:Boolean})],oo.prototype,"enableEmbedded",void 0),t7([(0,r.SB)()],oo.prototype,"open",void 0),t7([(0,r.SB)()],oo.prototype,"caipAddress",void 0),t7([(0,r.SB)()],oo.prototype,"caipNetwork",void 0),t7([(0,r.SB)()],oo.prototype,"shake",void 0),t7([(0,r.SB)()],oo.prototype,"filterByNamespace",void 0),t7([(0,r.SB)()],oo.prototype,"padding",void 0),t7([(0,r.SB)()],oo.prototype,"mobileFullScreen",void 0);let oi=class extends oo{};oi=t7([(0,U.Mo)("w3m-modal")],oi);let or=class extends oo{};or=t7([(0,U.Mo)("appkit-modal")],or);var oa=(0,U.iv)`
  .icon-box {
    width: 64px;
    height: 64px;
    border-radius: ${({borderRadius:e})=>e[5]};
    background-color: ${({colors:e})=>e.semanticError010};
  }
`;let on=class extends i.oi{constructor(){super()}render(){return(0,i.dy)`
      <wui-flex
        flexDirection="column"
        alignItems="center"
        gap="4"
        .padding="${["1","3","4","3"]}"
      >
        <wui-flex justifyContent="center" alignItems="center" class="icon-box">
          <wui-icon size="xxl" color="error" name="warningCircle"></wui-icon>
        </wui-flex>

        <wui-text variant="lg-medium" color="primary" align="center">
          The app isn't responding as expected
        </wui-text>
        <wui-text variant="md-regular" color="secondary" align="center">
          Try again or reach out to the app team for help.
        </wui-text>

        <wui-button
          variant="neutral-secondary"
          size="md"
          @click=${this.onTryAgainClick.bind(this)}
          data-testid="w3m-usage-exceeded-button"
        >
          <wui-icon color="inherit" slot="iconLeft" name="refresh"></wui-icon>
          Try Again
        </wui-button>
      </wui-flex>
    `}onTryAgainClick(){u.RouterController.goBack()}};on.styles=oa,on=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n}([(0,U.Mo)("w3m-usage-exceeded-view")],on);var os=o(74897);o(97928);var oc=(0,U.iv)`
  :host {
    width: 100%;
  }
`,ol=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let od=class extends i.oi{constructor(){super(...arguments),this.hasImpressionSent=!1,this.walletImages=[],this.imageSrc="",this.name="",this.size="md",this.tabIdx=void 0,this.disabled=!1,this.showAllWallets=!1,this.loading=!1,this.loadingSpinnerColor="accent-100",this.rdnsId="",this.displayIndex=void 0,this.walletRank=void 0,this.namespaces=[]}connectedCallback(){super.connectedCallback()}disconnectedCallback(){super.disconnectedCallback(),this.cleanupIntersectionObserver()}updated(e){super.updated(e),(e.has("name")||e.has("imageSrc")||e.has("walletRank"))&&(this.hasImpressionSent=!1),e.has("walletRank")&&this.walletRank&&!this.intersectionObserver&&this.setupIntersectionObserver()}setupIntersectionObserver(){this.intersectionObserver=new IntersectionObserver(e=>{e.forEach(e=>{!e.isIntersecting||this.loading||this.hasImpressionSent||this.sendImpressionEvent()})},{threshold:.1}),this.intersectionObserver.observe(this)}cleanupIntersectionObserver(){this.intersectionObserver&&(this.intersectionObserver.disconnect(),this.intersectionObserver=void 0)}sendImpressionEvent(){this.name&&!this.hasImpressionSent&&this.walletRank&&(this.hasImpressionSent=!0,(this.rdnsId||this.name)&&N.X.sendWalletImpressionEvent({name:this.name,walletRank:this.walletRank,rdnsId:this.rdnsId,view:u.RouterController.state.view,displayIndex:this.displayIndex}))}handleGetWalletNamespaces(){return Object.keys(os.j.state.adapters).length>1?this.namespaces:[]}render(){return(0,i.dy)`
      <wui-list-wallet
        .walletImages=${this.walletImages}
        imageSrc=${(0,a.o)(this.imageSrc)}
        name=${this.name}
        size=${(0,a.o)(this.size)}
        tagLabel=${(0,a.o)(this.tagLabel)}
        .tagVariant=${this.tagVariant}
        .walletIcon=${this.walletIcon}
        .tabIdx=${this.tabIdx}
        .disabled=${this.disabled}
        .showAllWallets=${this.showAllWallets}
        .loading=${this.loading}
        loadingSpinnerColor=${this.loadingSpinnerColor}
        .namespaces=${this.handleGetWalletNamespaces()}
      ></wui-list-wallet>
    `}};od.styles=oc,ol([(0,r.Cb)({type:Array})],od.prototype,"walletImages",void 0),ol([(0,r.Cb)()],od.prototype,"imageSrc",void 0),ol([(0,r.Cb)()],od.prototype,"name",void 0),ol([(0,r.Cb)()],od.prototype,"size",void 0),ol([(0,r.Cb)()],od.prototype,"tagLabel",void 0),ol([(0,r.Cb)()],od.prototype,"tagVariant",void 0),ol([(0,r.Cb)()],od.prototype,"walletIcon",void 0),ol([(0,r.Cb)()],od.prototype,"tabIdx",void 0),ol([(0,r.Cb)({type:Boolean})],od.prototype,"disabled",void 0),ol([(0,r.Cb)({type:Boolean})],od.prototype,"showAllWallets",void 0),ol([(0,r.Cb)({type:Boolean})],od.prototype,"loading",void 0),ol([(0,r.Cb)({type:String})],od.prototype,"loadingSpinnerColor",void 0),ol([(0,r.Cb)()],od.prototype,"rdnsId",void 0),ol([(0,r.Cb)()],od.prototype,"displayIndex",void 0),ol([(0,r.Cb)()],od.prototype,"walletRank",void 0),ol([(0,r.Cb)({type:Array})],od.prototype,"namespaces",void 0),od=ol([(0,U.Mo)("w3m-list-wallet")],od);var ou=(0,U.iv)`
  :host {
    --local-duration-height: 0s;
    --local-duration: ${({durations:e})=>e.lg};
    --local-transition: ${({easings:e})=>e["ease-out-power-2"]};
  }

  .container {
    display: block;
    overflow: hidden;
    overflow: hidden;
    position: relative;
    height: var(--local-container-height);
    transition: height var(--local-duration-height) var(--local-transition);
    will-change: height, padding-bottom;
  }

  .container[data-mobile-fullscreen='true'] {
    overflow: scroll;
  }

  .page {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    width: 100%;
    height: auto;
    width: inherit;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    background-color: ${({tokens:e})=>e.theme.backgroundPrimary};
    border-bottom-left-radius: var(--local-border-bottom-radius);
    border-bottom-right-radius: var(--local-border-bottom-radius);
    transition: border-bottom-left-radius var(--local-duration) var(--local-transition);
  }

  .page[data-mobile-fullscreen='true'] {
    height: 100%;
  }

  .page-content {
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }

  .footer {
    height: var(--apkt-footer-height);
  }

  div.page[view-direction^='prev-'] .page-content {
    animation:
      slide-left-out var(--local-duration) forwards var(--local-transition),
      slide-left-in var(--local-duration) forwards var(--local-transition);
    animation-delay: 0ms, var(--local-duration, ${({durations:e})=>e.lg});
  }

  div.page[view-direction^='next-'] .page-content {
    animation:
      slide-right-out var(--local-duration) forwards var(--local-transition),
      slide-right-in var(--local-duration) forwards var(--local-transition);
    animation-delay: 0ms, var(--local-duration, ${({durations:e})=>e.lg});
  }

  @keyframes slide-left-out {
    from {
      transform: translateX(0px) scale(1);
      opacity: 1;
      filter: blur(0px);
    }
    to {
      transform: translateX(8px) scale(0.99);
      opacity: 0;
      filter: blur(4px);
    }
  }

  @keyframes slide-left-in {
    from {
      transform: translateX(-8px) scale(0.99);
      opacity: 0;
      filter: blur(4px);
    }
    to {
      transform: translateX(0) translateY(0) scale(1);
      opacity: 1;
      filter: blur(0px);
    }
  }

  @keyframes slide-right-out {
    from {
      transform: translateX(0px) scale(1);
      opacity: 1;
      filter: blur(0px);
    }
    to {
      transform: translateX(-8px) scale(0.99);
      opacity: 0;
      filter: blur(4px);
    }
  }

  @keyframes slide-right-in {
    from {
      transform: translateX(8px) scale(0.99);
      opacity: 0;
      filter: blur(4px);
    }
    to {
      transform: translateX(0) translateY(0) scale(1);
      opacity: 1;
      filter: blur(0px);
    }
  }
`,op=function(e,t,o,i){var r,a=arguments.length,n=a<3?t:null===i?i=Object.getOwnPropertyDescriptor(t,o):i;if("object"==typeof Reflect&&"function"==typeof Reflect.decorate)n=Reflect.decorate(e,t,o,i);else for(var s=e.length-1;s>=0;s--)(r=e[s])&&(n=(a<3?r(n):a>3?r(t,o,n):r(t,o))||n);return a>3&&n&&Object.defineProperty(t,o,n),n};let oh=class extends i.oi{constructor(){super(...arguments),this.resizeObserver=void 0,this.transitionDuration="0.15s",this.transitionFunction="",this.history="",this.view="",this.setView=void 0,this.viewDirection="",this.historyState="",this.previousHeight="0px",this.mobileFullScreen=n.OptionsController.state.enableMobileFullScreen,this.onViewportResize=()=>{this.updateContainerHeight()}}updated(e){if(e.has("history")){let e=this.history;""!==this.historyState&&this.historyState!==e&&this.onViewChange(e)}e.has("transitionDuration")&&this.style.setProperty("--local-duration",this.transitionDuration),e.has("transitionFunction")&&this.style.setProperty("--local-transition",this.transitionFunction)}firstUpdated(){this.transitionFunction&&this.style.setProperty("--local-transition",this.transitionFunction),this.style.setProperty("--local-duration",this.transitionDuration),this.historyState=this.history,this.resizeObserver=new ResizeObserver(e=>{for(let t of e)if(t.target===this.getWrapper()){let e=t.contentRect.height,o=parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--apkt-footer-height")||"0");this.mobileFullScreen?(e=(window.visualViewport?.height||window.innerHeight)-this.getHeaderHeight()-o,this.style.setProperty("--local-border-bottom-radius","0px")):(e+=o,this.style.setProperty("--local-border-bottom-radius",o?"var(--apkt-borderRadius-5)":"0px")),this.style.setProperty("--local-container-height",`${e}px`),"0px"!==this.previousHeight&&this.style.setProperty("--local-duration-height",this.transitionDuration),this.previousHeight=`${e}px`}}),this.resizeObserver.observe(this.getWrapper()),this.updateContainerHeight(),window.addEventListener("resize",this.onViewportResize),window.visualViewport?.addEventListener("resize",this.onViewportResize)}disconnectedCallback(){let e=this.getWrapper();e&&this.resizeObserver&&this.resizeObserver.unobserve(e),window.removeEventListener("resize",this.onViewportResize),window.visualViewport?.removeEventListener("resize",this.onViewportResize)}render(){return(0,i.dy)`
      <div class="container" data-mobile-fullscreen="${(0,a.o)(this.mobileFullScreen)}">
        <div
          class="page"
          data-mobile-fullscreen="${(0,a.o)(this.mobileFullScreen)}"
          view-direction="${this.viewDirection}"
        >
          <div class="page-content">
            <slot></slot>
          </div>
        </div>
      </div>
    `}onViewChange(e){let t=e.split(",").filter(Boolean),o=this.historyState.split(",").filter(Boolean),i=o.length,r=t.length,a=t[t.length-1]||"",n=U.Hg.cssDurationToNumber(this.transitionDuration),s="";r>i?s="next":r<i?s="prev":r===i&&t[r-1]!==o[i-1]&&(s="next"),this.viewDirection=`${s}-${a}`,setTimeout(()=>{this.historyState=e,this.setView?.(a)},n),setTimeout(()=>{this.viewDirection=""},2*n)}getWrapper(){return this.shadowRoot?.querySelector("div.page")}updateContainerHeight(){let e=this.getWrapper();if(!e)return;let t=parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--apkt-footer-height")||"0"),o=0;this.mobileFullScreen?(o=(window.visualViewport?.height||window.innerHeight)-this.getHeaderHeight()-t,this.style.setProperty("--local-border-bottom-radius","0px")):(o=e.getBoundingClientRect().height+t,this.style.setProperty("--local-border-bottom-radius",t?"var(--apkt-borderRadius-5)":"0px")),this.style.setProperty("--local-container-height",`${o}px`),"0px"!==this.previousHeight&&this.style.setProperty("--local-duration-height",this.transitionDuration),this.previousHeight=`${o}px`}getHeaderHeight(){return 60}};oh.styles=[ou],op([(0,r.Cb)({type:String})],oh.prototype,"transitionDuration",void 0),op([(0,r.Cb)({type:String})],oh.prototype,"transitionFunction",void 0),op([(0,r.Cb)({type:String})],oh.prototype,"history",void 0),op([(0,r.Cb)({type:String})],oh.prototype,"view",void 0),op([(0,r.Cb)({attribute:!1})],oh.prototype,"setView",void 0),op([(0,r.SB)()],oh.prototype,"viewDirection",void 0),op([(0,r.SB)()],oh.prototype,"historyState",void 0),op([(0,r.SB)()],oh.prototype,"previousHeight",void 0),op([(0,r.SB)()],oh.prototype,"mobileFullScreen",void 0),oh=op([(0,U.Mo)("w3m-router-container")],oh)}}]);