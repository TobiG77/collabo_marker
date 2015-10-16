import "deps/phoenix_html/web/static/js/phoenix_html"
import {Socket} from "deps/phoenix/web/static/js/phoenix/"

angular.module("collaboMarkerApp", [])
    .directive("scrollToBottom", function(){
        return {
            restrict: "A",
            scope: {
                trigger: "=scrollToBottom"
            },
            link: function postLink(scope, elem) {
                scope.$watch("trigger", function() {
                    elem[0].scrollTop = elem[0].scrollHeight - elem[0].offsetHeight;
                });
            }
        };
    })
    .controller("CollaboMarkerController", ["$scope", "$http", function($scope, $http) {

        $scope.users = [];
        $scope.input = {};
        $scope.receivedMessages = [];
        $scope.myself = null;
        $scope.toast = null;

        var editor = ace.edit("cm-editor"),
            // 他ユーザからの push が無限ループしないように制御するフラグ
            // （ace の仕様上、これがないとうまく制御できなかったため）
            isFromMe = true,
            aceTextInputElement = null,
            cmEditorElement = null,
            cmPreviewElement = null,
            saveTimer = null,
            saveWaitTime = 2000,
            applyTimer = null,
            applyWaitTime = 500,
            isAfterApply = false;

        var socket = new Socket("/socket");
        socket.connect();
        var channel = socket.channel("editor:lobby", {});
        channel.join().receive("ok", function(dt) {
            dt.users.forEach(function(user) {
                user.cursor = {};
                $scope.users.push(user);
            });
            var contents = dt.contents;
            if ($scope.users.length == 0 && !contents) {
                contents = "# ‘Allo, ‘Allo!\n\n---\n\n* Maybe, You are the first person to come here!\n* Fill the name in the input box below and let's get started!"
;
            }
            isFromMe = false;
            editor.setValue(contents);
            editor.clearSelection();
            calculateCursorScreenPosition();

            $scope.$apply();
        });

        // editor setting
        editor.$blockScrolling = Infinity;
        editor.setTheme("ace/theme/monokai");
        editor.getSession().setMode("ace/mode/markdown");
        editor.getSession().setUseWrapMode(true);
        editor.setReadOnly(true);

        editor.on("input", function() {
            isFromMe = true;
        });

        editor.on("change", function(e) {
            if (isAfterApply) {
                return;
            }
            if (isFromMe) {
                channel.push("edit", { user: $scope.myself, event: e });
            }
            document.getElementById("cm-preview").innerHTML = marked(editor.getValue());
            if (saveTimer) {
                clearTimeout(saveTimer);
            }
            saveTimer = setTimeout(save, saveWaitTime); 
            if (applyTimer) {
                clearTimeout(applyTimer);
            }
            applyTimer = setTimeout(applyContent, applyWaitTime);
        });

        editor.session.selection.on("changeCursor", function(e) {
            if (!$scope.myself) {
                return;
            }
            // .ace_text-input に座標が適応されるのに少しラグがあるので、100ms 遅延させます
            setTimeout(function() {
                // getCursorPosition だと正確な絶対座標が割り出せないため、ace_text-input の座標を利用します
                if (!aceTextInputElement) {
                    aceTextInputElement = document.getElementsByClassName("ace_text-input")[0];
                }

                var style = window.getComputedStyle(aceTextInputElement),
                    top = style.getPropertyValue("top"),
                    left = style.getPropertyValue("left"),
                    scrollTop = editor.getSession().getScrollTop();

                top = Number(top.substring(0, top.length - 2));
                left = Number(left.substring(0, left.length - 2));

                if (top === 0 && left === 0) {
                    return;
                }

                channel.push("move", { user: $scope.myself, position: {left: left, top: top, scrollTop: scrollTop} });
            }, 100);
        });

        editor.session.on("changeScrollTop", function() {
            calculateCursorScreenPosition();
            calculatePreviewScrolltop();
        });

        function applyChangeEvent(event) {
            var doc = editor.getSession().getDocument();
            var action = event.action;
            if (action === "insert") {
                doc.insertMergedLines(event.start, event.lines);
            } else if (action === "remove") {
                doc.remove(event);
            }
        }

        function calculateCursorScreenPosition() {
            if (!cmEditorElement) {
                cmEditorElement = document.getElementById("cm-editor");
            }

            $scope.users.forEach(function(user) {
                if ($scope.myself && user.name === $scope.myself.name) {
                    user.cursor.hidden = true;
                    return;
                }
                if (!("top" in user.cursor) || !("left" in user.cursor)) {
                    user.cursor.hidden = true;
                    return;
                }
                var de = document.documentElement,
                    box = cmEditorElement.getBoundingClientRect(),
                    offsetTop = box.top + window.pageYOffset - de.clientTop,
                    offsetLeft = box.left + window.pageXOffset - de.clientLeft;

                var top = user.cursor.top + user.cursor.scrollTop - editor.getSession().getScrollTop() + 4;
                user.cursor.hidden = (top < 0 || top > 500);

                user.cursor.screenLeft = user.cursor.left + offsetLeft + "px";
                user.cursor.screenTop = top + offsetTop + "px";
            });

            $scope.$apply();
        }

        function calculatePreviewScrolltop() {
            // XXX: want to more smoothly...
            var startRow = editor.getFirstVisibleRow(),
                length = editor.getSession().getDocument().getLength(),
                ratio = startRow / length;

            if (!cmPreviewElement) {
                cmPreviewElement = angular.element(document.querySelector("#cm-preview"))[0];
            }
            cmPreviewElement.scrollTop = cmPreviewElement.scrollHeight * ratio;
        }

        function save() {
            $http({
                method: "POST",
                url: "/save",
                data: { contents: editor.getValue() },
                headers: ["application/json"]
            });
        }

        function applyContent() {
            editor.setReadOnly(true);
            isAfterApply = true;
            var cursor = editor.getCursorPosition(),
                range = editor.getSelection().getRange();
            editor.setValue(editor.getValue());
            editor.moveCursorTo(cursor.row, cursor.column);
            editor.getSelection().setRange(range);
            editor.setReadOnly(false);
            isAfterApply = false;
        }

        function showToastMessage(type, message, _interval) {
            $scope.toast = {
                type: type,
                message: message
            };
            $scope.$apply();
            var interval = _interval || 3000;
            setTimeout(function() {
                $scope.toast = null;
                $scope.$apply();
            }, interval);
        }

        channel.on("edit", function(dt) {
            if ($scope.myself && dt.user.name === $scope.myself.name) {
                return;
            }
            isFromMe = false;
            applyChangeEvent(dt.event);
        });

        channel.on("move", function(dt) {
            if ($scope.myself && dt.user.name === $scope.myself.name) {
                return;
            }
            var user = null;
            $scope.users.some(function(elem) {
                if (elem.name === dt.user.name) {
                    user = elem;
                }
            });
            user.cursor.left = dt.position.left;
            user.cursor.top = dt.position.top;
            user.cursor.scrollTop = dt.position.scrollTop;

            calculateCursorScreenPosition();
        });

        channel.on("update_user", function(dt) {
            $scope.users = [];
            dt.users.forEach(function(user) {
                user.cursor = {};
                $scope.users.push(user);
            });
            $scope.$apply();
            calculateCursorScreenPosition();

            // TODO: show join or disconnect message

        });

        channel.on("message", function(dt) {
            $scope.receivedMessages.push(dt);
            $scope.$apply();
        });

        $scope.sendMessage = function() {
            if (!$scope.input.message) {
                return;
            }
            channel.push("message", { user: $scope.myself, message: $scope.input.message });
            $scope.input.message = "";
        };

        $scope.join = function() {
            if (!$scope.input.name) {
                return;
            }
            var user = {
                name: $scope.input.name,
                color: randomColor({luminosity: "light"})
            };
            channel.push("join", { user: user }).receive("ok", function(msg) {
                $scope.myself = user;
                editor.setReadOnly(false);
                showToastMessage("note", "Welcome! " + user.name);
            }).receive("error", function(msg) {
                showToastMessage("alert", "User name is duplicated!");
            });
        };

        $scope.getColorFromType = function(type) {
            if (type === "alert") {
                return "rgba(255, 100, 100, 0.5)";
            } else {
                return "rgba(100, 255, 100, 0.5)";
            }
        }

    }]);
