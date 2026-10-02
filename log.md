   Experiment 1
   
   +0.0s  action  start (normal)
   +1.6s  note    call id 01a0fcd4-8727-7cc9-be6c-fcc8c8cafe67; conversation id vapi_01a0fcd4-8727-7cc9-be6c-fcc8c8cafe67
   +3.5s  event   call-start
   +3.5s  message assistant.started
   +3.5s  message status-update status=in-progress
   +3.6s  message speech-update role=assistant status=started
   +3.8s  event   assistant audio started (speech-start)
   +4.0s  action  mute microphone
   +4.0s  note    microphone muted: false
   +4.4s  message transcript role=assistant transcriptType=partial
   +4.6s  message transcript role=assistant transcriptType=partial
   +4.8s  message transcript role=assistant transcriptType=partial
   +5.0s  message transcript role=assistant transcriptType=partial
   +5.1s  message transcript role=assistant transcriptType=partial
   +5.3s  message transcript role=assistant transcriptType=partial
   +5.6s  message transcript role=assistant transcriptType=partial
   +5.8s  message transcript role=assistant transcriptType=partial
   +5.9s  message transcript role=assistant transcriptType=partial
   +6.0s  action  mute microphone
   +6.0s  note    microphone muted: true
   +6.0s  message transcript role=assistant transcriptType=partial
   +6.1s  message transcript role=assistant transcriptType=partial
   +6.3s  message transcript role=assistant transcriptType=partial
   +6.5s  message transcript role=assistant transcriptType=partial
   +6.9s  message transcript role=assistant transcriptType=partial
   +7.1s  message transcript role=assistant transcriptType=partial
   +7.5s  message transcript role=assistant transcriptType=partial
   +7.6s  message transcript role=assistant transcriptType=partial
   +7.7s  message transcript role=assistant transcriptType=partial
   +7.8s  message speech-update role=assistant status=stopped
   +7.8s  message transcript role=assistant transcriptType=partial
   +8.0s  message transcript role=assistant transcriptType=partial
   +8.2s  message transcript role=assistant transcriptType=partial
   +8.5s  event   assistant audio stopped (speech-end)
   +8.8s  message transcript role=assistant transcriptType=partial
   +8.8s  message transcript role=assistant transcriptType=partial
   +8.8s  message transcript role=assistant transcriptType=final
   +8.8s  message conversation-update
  +31.1s  message status-update status=ended endedReason=assistant-ended-call-after-message-spoken
  +31.5s  error   [object Object]
  +31.5s  event   call-end
















  Experiment 2
  2. No
  
  Experiment 3
  3.    +0.0s  action  start (normal)
   +1.8s  note    call id 01a0fcd6-8dc1-7000-923b-91d3bae2f0f0; conversation id vapi_01a0fcd6-8dc1-7000-923b-91d3bae2f0f0
   +3.5s  event   call-start
   +3.6s  message assistant.started
   +3.6s  message status-update status=in-progress
   +3.7s  message speech-update role=assistant status=started
   +3.9s  event   assistant audio started (speech-start)
   +4.5s  message transcript role=assistant transcriptType=partial
   +4.8s  message transcript role=assistant transcriptType=partial
   +4.9s  message transcript role=assistant transcriptType=partial
   +5.0s  message transcript role=assistant transcriptType=partial
   +5.1s  message transcript role=assistant transcriptType=partial
   +5.5s  message transcript role=assistant transcriptType=partial
   +5.6s  message transcript role=assistant transcriptType=partial
   +5.8s  message transcript role=assistant transcriptType=partial
   +6.0s  message transcript role=assistant transcriptType=partial
   +6.2s  message transcript role=assistant transcriptType=partial
   +6.3s  message transcript role=assistant transcriptType=partial
   +6.5s  message transcript role=assistant transcriptType=partial
   +7.0s  message transcript role=assistant transcriptType=partial
   +7.2s  message transcript role=assistant transcriptType=partial
   +7.6s  message transcript role=assistant transcriptType=partial
   +7.8s  message transcript role=assistant transcriptType=partial
   +7.8s  message speech-update role=assistant status=stopped
   +7.9s  message transcript role=assistant transcriptType=partial
   +8.0s  message transcript role=assistant transcriptType=partial
   +8.2s  message transcript role=assistant transcriptType=partial
   +8.6s  event   assistant audio stopped (speech-end)
   +9.1s  action  mute assistant (control message)
   +9.1s  message transcript role=assistant transcriptType=partial
   +9.1s  message transcript role=assistant transcriptType=partial
   +9.1s  message transcript role=assistant transcriptType=final
   +9.1s  message conversation-update
  +12.7s  message speech-update role=user status=started
  +12.8s  message transcript role=user transcriptType=partial
  +12.9s  message transcript role=user transcriptType=partial
  +13.0s  message transcript role=user transcriptType=partial
  +13.2s  message transcript role=user transcriptType=partial
  +13.3s  message transcript role=user transcriptType=partial
  +13.4s  message transcript role=user transcriptType=partial
  +13.5s  message transcript role=user transcriptType=partial
  +13.6s  message transcript role=user transcriptType=partial
  +13.8s  message transcript role=user transcriptType=partial
  +14.3s  message transcript role=user transcriptType=partial
  +14.3s  message speech-update role=user status=stopped
  +14.7s  message transcript role=user transcriptType=partial
  +14.8s  message transcript role=user transcriptType=partial
  +15.5s  message transcript role=user transcriptType=partial
  +16.0s  message transcript role=user transcriptType=partial
  +16.1s  message transcript role=user transcriptType=partial
  +16.1s  message conversation-update
  +16.1s  message transcript role=user transcriptType=final
  +17.5s  message transcript role=user transcriptType=partial
  +17.6s  message transcript role=user transcriptType=partial
  +17.7s  message transcript role=user transcriptType=partial
  +18.0s  message transcript role=user transcriptType=partial
  +18.2s  message transcript role=user transcriptType=partial
  +18.6s  message transcript role=user transcriptType=partial
  +18.8s  message transcript role=user transcriptType=partial
  +18.8s  message conversation-update
  +18.8s  message transcript role=user transcriptType=final
  +23.8s  message hang
  +31.2s  message status-update status=ended endedReason=assistant-ended-call-after-message-spoken
  +31.4s  error   [object Object]
  +31.4s  event   call-end


Experiment 4
  4.    +0.0s  action  start (keep the call alive when the browser leaves)
   +1.6s  note    call id 01a0fcd7-834c-7000-8293-9cb0293903dd; conversation id vapi_01a0fcd7-834c-7000-8293-9cb0293903dd
   +4.0s  event   call-start
   +4.0s  message assistant.started
   +4.0s  message status-update status=in-progress
   +4.1s  message speech-update role=assistant status=started
   +4.4s  event   assistant audio started (speech-start)
   +5.0s  message transcript role=assistant transcriptType=partial
   +5.2s  message transcript role=assistant transcriptType=partial
   +5.3s  message transcript role=assistant transcriptType=partial
   +5.4s  message transcript role=assistant transcriptType=partial
   +5.6s  message transcript role=assistant transcriptType=partial
   +5.9s  message transcript role=assistant transcriptType=partial
   +6.0s  message transcript role=assistant transcriptType=partial
   +6.3s  message transcript role=assistant transcriptType=partial
   +6.4s  message transcript role=assistant transcriptType=partial
   +6.6s  message transcript role=assistant transcriptType=partial
   +6.8s  message transcript role=assistant transcriptType=partial
   +7.0s  message transcript role=assistant transcriptType=partial
   +7.5s  message transcript role=assistant transcriptType=partial
   +7.6s  message transcript role=assistant transcriptType=partial
   +8.1s  message transcript role=assistant transcriptType=partial
   +8.2s  message transcript role=assistant transcriptType=partial
   +8.2s  message speech-update role=assistant status=stopped
   +8.3s  message transcript role=assistant transcriptType=partial
   +8.4s  message transcript role=assistant transcriptType=partial
   +8.6s  message transcript role=assistant transcriptType=partial
   +8.7s  message transcript role=assistant transcriptType=partial
   +9.1s  event   assistant audio stopped (speech-end)
   +9.2s  action  leave (stop)
   +9.3s  event   call-end
   +9.3s  message status-update status=ended endedReason=customer-ended-call
  +18.4s  action  reconnect to the same call
  +19.4s  event   call-start
  +19.4s  note    reconnect returned
  +24.1s  message speech-update role=user status=started
  +24.4s  message transcript role=user transcriptType=partial
  +24.5s  message transcript role=user transcriptType=partial
  +24.6s  message transcript role=user transcriptType=partial
  +25.1s  message transcript role=user transcriptType=partial
  +25.2s  message transcript role=user transcriptType=partial
  +25.2s  message transcript role=user transcriptType=partial
  +25.3s  message transcript role=user transcriptType=partial
  +25.4s  message transcript role=user transcriptType=partial
  +25.4s  message transcript role=user transcriptType=partial
  +25.6s  message speech-update role=user status=stopped
  +26.1s  message transcript role=user transcriptType=partial
  +26.7s  message transcript role=user transcriptType=partial
  +26.7s  message transcript role=user transcriptType=partial
  +26.7s  message conversation-update
  +26.7s  message transcript role=user transcriptType=final
  +27.3s  message transcript role=user transcriptType=partial
  +27.5s  message transcript role=user transcriptType=partial
  +27.7s  message transcript role=user transcriptType=partial
  +27.8s  message transcript role=user transcriptType=partial
  +28.2s  message transcript role=user transcriptType=partial
  +28.6s  message transcript role=user transcriptType=partial
  +28.6s  message conversation-update
  +28.6s  message transcript role=user transcriptType=final
  +31.2s  message model-output
  +31.2s  message voice-input
  +33.6s  message hang
  +37.6s  message transcript role=user transcriptType=partial
  +37.6s  message conversation-update
  +37.6s  message transcript role=user transcriptType=final
  +40.0s  message transcript role=user transcriptType=partial
  +40.2s  message transcript role=user transcriptType=partial
  +45.2s  message hang
  +45.8s  action  mute microphone
  +45.8s  note    microphone muted: false


  5.    +0.0s  action  start (keep the call alive when the browser leaves)
   +1.8s  note    call id 01a0fcd8-b382-722a-8f23-00817b5ef9c0; conversation id vapi_01a0fcd8-b382-722a-8f23-00817b5ef9c0
   +3.4s  event   call-start
   +3.4s  message assistant.started
   +3.4s  message status-update status=in-progress
   +3.4s  message speech-update role=assistant status=started
   +3.7s  event   assistant audio started (speech-start)
   +3.9s  message transcript role=user transcriptType=partial
   +3.9s  message conversation-update
   +3.9s  message transcript role=user transcriptType=final
   +4.3s  message transcript role=assistant transcriptType=partial
   +4.5s  message transcript role=assistant transcriptType=partial
   +4.6s  message transcript role=assistant transcriptType=partial
   +4.8s  message transcript role=assistant transcriptType=partial
   +4.9s  message transcript role=assistant transcriptType=partial
   +5.2s  message transcript role=assistant transcriptType=partial
   +5.3s  message transcript role=assistant transcriptType=partial
   +5.6s  message transcript role=assistant transcriptType=partial
   +5.7s  message transcript role=assistant transcriptType=partial
   +5.9s  message transcript role=assistant transcriptType=partial
   +6.1s  message transcript role=assistant transcriptType=partial
   +6.3s  message transcript role=assistant transcriptType=partial
   +6.8s  message transcript role=assistant transcriptType=partial
   +6.9s  message transcript role=assistant transcriptType=partial
   +7.4s  message transcript role=assistant transcriptType=partial
   +7.5s  message transcript role=assistant transcriptType=partial
   +7.6s  message speech-update role=assistant status=stopped
   +7.6s  message transcript role=assistant transcriptType=partial
   +7.8s  message transcript role=assistant transcriptType=partial
   +7.9s  message transcript role=assistant transcriptType=partial
   +8.0s  message transcript role=assistant transcriptType=partial
   +8.4s  action  leave (stop)
   +8.4s  event   call-end
   +8.4s  message status-update status=ended endedReason=customer-ended-call
   +8.4s  event   assistant audio stopped (speech-end)
 +106.3s  action  reconnect to the same call
 +107.5s  error   [object Object]
 +107.5s  error   [object Object]
 +107.5s  error   Meeting has ended
 +112.2s  action  reconnect to the same call
 +113.5s  error   [object Object]
 +113.5s  error   [object Object]
 +113.5s  error   Meeting has ended