#!/bin/bash
BIN=$PWD/target/debug/solid-gpui-helper
{
printf '%s\n' '{"v":1,"seq":70,"mutations":[{"op":"createElement","id":1,"elementType":"div"},{"op":"setRoot","id":1},{"op":"createElement","id":2,"elementType":"div"},{"op":"appendChild","parentId":1,"childId":2},{"op":"setStyle","id":2,"style":{"tabIndex":0}},{"op":"setEventListener","id":2,"eventType":"focus","enabled":true},{"op":"setEventListener","id":2,"eventType":"blur","enabled":true},{"op":"createElement","id":3,"elementType":"div"},{"op":"appendChild","parentId":1,"childId":3},{"op":"setStyle","id":3,"style":{"tabIndex":0}},{"op":"setEventListener","id":3,"eventType":"focus","enabled":true},{"op":"setEventListener","id":3,"eventType":"blur","enabled":true}]}'
printf '%s\n' '{"type":"focusElement","seq":71,"id":2}'
sleep 0.5
printf '%s\n' '{"type":"focusElement","seq":72,"id":3}'
sleep 0.5
} | "$BIN" --stdio-window 2>/dev/null | head -30
