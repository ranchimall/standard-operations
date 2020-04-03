# JavaScript beginner
 This section is for those who are new to javaScript
 It provides
 1. Basics about JavaScript
 2. Help how to read this code
 3. First hand guide to small edit
 4. Approach to debug this code


 ## Basics about JavaScript
I see https://www.w3schools.com/js is a good tutorial for beginners

 ## Help how to read this code
 This code has following modules  
 **floGlobals** This contains global data which mainly includes (but not all)
 1. Production grade FLO nodes URL, which is used for performing FLO operations (balance enquiry for example)
 2. Test FLO URL, for testing purpose. Capability is same as Production grade nodes URL
 3. Few defaults (default fee, default send amount) 

 **iniit_lib** This contains load time initialization actions like
 1.  Callback registering for Reactor (Reactive programming). Reactors are approach for event based coding
 2.  Crypto APIs: PBKDF2, Elliptic Curve, BigInteger, BitCoin related APIs

 **floCrypto** It contains Cryptographic operations
 1. Sign, verify, encryption, decryption of data
 2. Validation of Flo address  

 **floBlockchainAPI** It contains block-chain operations to interact with FLO node (Production/Test)
 1. Read/Write transaction
 2. Balance enquiry  

 **compactIDB** FLO maintains browser level DB and this module takes care of DB management

 **floDapps** I initializes on html load, performs credential related operations


 ## First hand guide to small edit
 1. As a first step, you can simply edit the Welcome popup. To Do this,  please edit alert message in onLoadStartUp routine
 2. Similarly, you can edit the popup which asks for providing FLO privKey
 3. Then after, explore operations in floBlockchainAPI


 ## Approach to debug this code
 JavaScript provides multiple ways to debug a code. 
 1. Via dialog box
 This is simplest approach. For example, if you want to inspect any value, you will add code in script whereever you want to display any value.
 This approach uses window.alert() API
 Refer: https://www.w3schools.com/js/js_popup.asp
 2. Via console log
 This is also simple. Please ensure to start console in browser before running the code in browser. For example, if you want to inspect any value, you will add code in script whereever you want to display any value.
 This uses console.log() API
 Refer: https://www.w3schools.com/js/js_debugging.asp
 3. Via breakpoint
 This is advanced approach. Interestingly, browser do support inserting breakpoint. At this point, browser halts and ask your permission to proceed. 
 This uses debugger keyword in JavaScript
 In general, breakpoint allows to debug any issue faster. breakpoint allows for 
 - step-by-step debugging.
 - Provides advanced debugging tools like watch, callstack etc.
 Refer: https://developers.google.com/web/tools/chrome-devtools/javascript#reproduce
 

