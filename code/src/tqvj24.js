// Vertex shader program
var VSHADER_SOURCE = `
    attribute vec4 a_Position;
    attribute vec4 a_Color;
    attribute vec4 a_Normal;
    attribute vec2 a_TexCoords;
    uniform mat4 u_ModelMatrix;
    uniform mat4 u_NormalMatrix;
    uniform mat4 u_ViewMatrix;
    uniform mat4 u_ProjMatrix;
    uniform vec3 u_LightColor;
    uniform vec3 u_LightDirection;
    varying vec4 v_Color;
    uniform bool u_isLighting;
    varying vec3 v_Normal;
    varying vec2 v_TexCoords;
    varying vec3 v_Position;
    void main() {
        gl_Position = u_ProjMatrix * u_ViewMatrix * u_ModelMatrix * a_Position;
        v_Position = vec3(u_ModelMatrix * a_Position);
        v_Normal = normalize(vec3(u_NormalMatrix * a_Normal));
        if(u_isLighting) {
            vec3 normal = normalize((u_NormalMatrix * a_Normal).xyz);
            float nDotL = max(dot(normal, u_LightDirection), 0.0);
            vec3 diffuse = u_LightColor * a_Color.rgb * nDotL;
            v_Color = vec4(diffuse, a_Color.a);
        } else {
            v_Color = a_Color;
        }
        v_TexCoords = a_TexCoords;
    }
`;

// Fragment shader program
var FSHADER_SOURCE = `
    #ifdef GL_ES
    precision mediump float;
    #endif
    uniform bool u_UseTextures;
    uniform vec3 u_LightColorB;
    uniform vec3 u_LightPosition;
    varying vec3 v_Normal;
    varying vec3 v_Position;
    varying vec4 v_Color;
    uniform bool u_isPointLighting;
    void main() {
        if(u_isPointLighting) {
            vec3 normal = normalize(v_Normal);
            vec3 lightDirection = normalize(u_LightPosition - v_Position);
            float nDotL = max(dot(lightDirection, normal), 0.0);
            vec3 diffuse = u_LightColorB * v_Color.rgb * nDotL;
            gl_FragColor = vec4(diffuse + v_Color.rgb, v_Color.a);
        } else {
            gl_FragColor = v_Color;
        }
    }
`;

var modelMatrix = new Matrix4(); // The model matrix
var viewMatrix = new Matrix4();  // The view matrix
var projMatrix = new Matrix4();  // The projection matrix
var g_normalMatrix = new Matrix4();  // Coordinate transformation matrix for normals
var u_ViewMatrix;
var vertices_length = 72; // known for the cube - changes when vertices array actually made if needed
var g_matrixStack = [];
var n;

// Constant values
var WHEEL_ANGLE_STEP = 8.0; // The amount the wheels turn (degrees) per forward/backward step
var TURNING_ANGLE_STEP = 2.5; // The increments of rotation angle (in degrees) for turning
var DRIVE_DISPLACEMENT_STEP = 0.25; // The distance moved in a single step forward/backward

// Starting values
var wheel_rotation_angle = 0.0; // The wheel rotation x angle (degrees)
var turning_angle = 135; // The car rotation y angle (degrees)
var xDisplacement = 0.0;
var zDisplacement = 0.0;
var doors_open = false;
var door_cooldown = 0;
var heldKeys = {};
var directionalLighting = true;
var pointLighting = true;
var waitingForLightingDraw = false;

// HTML Elements (for controls to show values of toggles)
var elemDoors;
var elemPoint;
var elemDirec;

function main() {
    // Retrieve DOM elements
    var canvas = document.getElementById('webgl');
    elemDoors = document.getElementById("spnDoors");
    elemPoint = document.getElementById("spnPointLight");
    elemDirec = document.getElementById("spnDirectLight");

    // Get the rendering context for WebGL
    var gl = getWebGLContext(canvas);
    if (!gl) {
        console.log('Failed to get the rendering context for WebGL');
        return;
    }

    // Initialize shaders
    if (!initShaders(gl, VSHADER_SOURCE, FSHADER_SOURCE)) {
        console.log('Failed to intialize shaders.');
        return;
    }

    // Set clear color and enable hidden surface removal
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.enable(gl.DEPTH_TEST);

    // Clear color and depth buffer
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Get the storage locations of uniform attributes
    var u_ModelMatrix = gl.getUniformLocation(gl.program, 'u_ModelMatrix');
    u_ViewMatrix = gl.getUniformLocation(gl.program, 'u_ViewMatrix');
    var u_NormalMatrix = gl.getUniformLocation(gl.program, 'u_NormalMatrix');
    var u_ProjMatrix = gl.getUniformLocation(gl.program, 'u_ProjMatrix');
    var u_LightColor = gl.getUniformLocation(gl.program, 'u_LightColor');
    var u_LightColorB = gl.getUniformLocation(gl.program, 'u_LightColorB');
    var u_LightDirection = gl.getUniformLocation(gl.program, 'u_LightDirection');
    var u_LightPosition = gl.getUniformLocation(gl.program, 'u_LightPosition');

    // Trigger using lighting or not
    var u_isLighting = gl.getUniformLocation(gl.program, 'u_isLighting');
    var u_isPointLighting = gl.getUniformLocation(gl.program, 'u_isPointLighting');

    if (!u_ModelMatrix || !u_ViewMatrix || !u_NormalMatrix || !u_ProjMatrix || !u_LightColor || !u_LightColorB || !u_LightDirection || !u_isLighting || !u_LightPosition) {
        console.log('Failed to Get the storage locations of u_ModelMatrix, u_ViewMatrix, and/or u_ProjMatrix');
        return;
    }

    // DIRECTIONAL LIGHTING
    gl.uniform3f(u_LightColor, 1.0, 1.0, 1.0);
    // POINT LIGHTING
    gl.uniform3f(u_LightColorB, 1.0, 1.0, 1.0);

    // Set the light direction (in the world coordinate)
    var lightDirection = new Vector3([2.5, 3, 4.0]);
    lightDirection.normalize(); // Normalize
    gl.uniform3fv(u_LightDirection, lightDirection.elements);
    // Set the light position for point light
    gl.uniform3f(u_LightPosition, 0, 2.5, 0); // y was 1.7

    // Calculate the view matrix and the projection matrix
    viewMatrix.setLookAt(0, 25, 50, xDisplacement, 0, zDisplacement, 0, 1, 0);
    projMatrix.setPerspective(30, canvas.width / canvas.height, 1, 100);
    // Pass the model, view, and projection matrix to the uniform variable respectively
    gl.uniformMatrix4fv(u_ViewMatrix, false, viewMatrix.elements);
    gl.uniformMatrix4fv(u_ProjMatrix, false, projMatrix.elements);

    document.onkeydown = document.onkeyup = function (e) {
        e = e || event; // IE compatibility
        if (e.keyCode == 75 && e.type == 'keydown') {
            pointLighting = !pointLighting;
            waitingForLightingDraw = true;
            elemPoint.className = pointLighting ? "toggle on" : "toggle";
            elemPoint.innerHTML = pointLighting ? "ON" : "OFF";
        } else if (e.keyCode == 76 && e.type == 'keydown') {
            directionalLighting = !directionalLighting;
            waitingForLightingDraw = true;
            elemDirec.className = directionalLighting ? "toggle on" : "toggle";
            elemDirec.innerHTML = directionalLighting ? "ON" : "OFF";
        } else if (e.keyCode == 79) {
            // Door cooldown to avoid flickering doors
            if (door_cooldown < 1 && e.type != 'keyup') {
                door_cooldown = 6;
                doors_open = !doors_open;
                elemDoors.className = doors_open ? "toggle on" : "toggle";
                elemDoors.innerHTML = doors_open ? "OPEN" : "CLOSED";
                draw(gl, u_ModelMatrix, u_NormalMatrix, u_isLighting);
            } else {
                console.log("Cannot toggle doors so quickly - remaining cooldown: ", door_cooldown)
            }
        } else {
            heldKeys[e.keyCode] = e.type == 'keydown';
        }
    };

    n = initVertexBuffers(gl, [0.5, 0.5, 0.5]);

    function animateFrame() {
        if (door_cooldown > 0) {
            door_cooldown -= 1;
        }
        checkKeys(gl, u_ModelMatrix, u_NormalMatrix, u_isLighting, u_isPointLighting);
        window.requestAnimationFrame(animateFrame);
    }

    draw(gl, u_ModelMatrix, u_NormalMatrix, u_isLighting, u_isPointLighting);

    window.requestAnimationFrame(animateFrame);
}

function turnCar(turnLeft, reversing) {
    if (reversing) {
        turnLeft = !turnLeft;
    }
    if (turnLeft) {
        turning_angle = (turning_angle + TURNING_ANGLE_STEP) % 360;
    } else {
        turning_angle = (turning_angle - TURNING_ANGLE_STEP) % 360;
    }
}

function moveCar(forward) {
    var xDiff = Math.sin(turning_angle * Math.PI / 180) * DRIVE_DISPLACEMENT_STEP;
    var zDiff = Math.cos(turning_angle * Math.PI / 180) * DRIVE_DISPLACEMENT_STEP;
    if (forward) {
        wheel_rotation_angle = (wheel_rotation_angle - WHEEL_ANGLE_STEP) % 360;
        xDisplacement -= xDiff;
        zDisplacement -= zDiff;
    } else {
        wheel_rotation_angle = (wheel_rotation_angle + WHEEL_ANGLE_STEP) % 360;
        xDisplacement += xDiff;
        zDisplacement += zDiff;
    }
}

function checkKeys(gl, u_ModelMatrix, u_NormalMatrix, u_isLighting, u_isPointLighting) {
    var recognised = waitingForLightingDraw;
    var reversing = false;

    // Move
    if (heldKeys[38]) {         // Up arrow - drive forward
        recognised = true;
        moveCar(true);
    } else if (heldKeys[40]) {  //Down arrow - drive backward
        recognised = true;
        reversing = true;
        moveCar(false);
    }

    // Turn
    if (heldKeys[39]) {         // Right arrow - turn right (y axis rotation)
        recognised = true;
        turnCar(false, reversing);
    } else if (heldKeys[37]) {  // Left arrow - turn left (y axis negative rotation)
        recognised = true;
        turnCar(true, reversing);
    }

    // Avoid error on O press - actually handled in key event handler due to cooldown to avoid flicker
    if (heldKeys[79]) {         // O - toggle doors
        recognised = true;
    }

    // Only update things if buttons are held
    if (recognised) {
        // Bound car to plain (plain is -20 to 20, avoid overhanging wheels etc)
        if (xDisplacement > 18) {
            xDisplacement = 18;
        }
        if (xDisplacement < -18) {
            xDisplacement = -18;
        }
        if (zDisplacement > 18) {
            zDisplacement = 18;
        }
        if (zDisplacement < -18) {
            zDisplacement = -18;
        }

        // Force camera to always look at the car
        viewMatrix.setLookAt(0, 25, 50, xDisplacement, 0, zDisplacement, 0, 1, 0);
        gl.uniformMatrix4fv(u_ViewMatrix, false, viewMatrix.elements);

        // Redraw the scene
        draw(gl, u_ModelMatrix, u_NormalMatrix, u_isLighting, u_isPointLighting);
    }
}

function pushMatrix(m) {
    var m2 = new Matrix4(m);
    g_matrixStack.push(m2);
}

function popMatrix() {
    return g_matrixStack.pop();
}

function setColour(gl, baseColour) {
    // Generate colors (DONE PER OBJECT - all vertices of each PART of the car the same colour)
    var myColours = [];
    while (myColours.length < vertices_length) { // 72 is length of vertex array for the cube
        myColours.push(baseColour[0]);
        myColours.push(baseColour[1]);
        myColours.push(baseColour[2]);
    }
    var colors = new Float32Array(myColours);
    if (!initArrayBuffer(gl, 'a_Color', colors, 3, gl.FLOAT)) return -1;
}

function initVertexBuffers(gl, baseColour) {
    // Create a cube
    //    v6----- v5
    //   /|      /|
    //  v1------v0|
    //  | |     | |
    //  | |v7---|-|v4
    //  |/      |/
    //  v2------v3
    var vertices = new Float32Array([   // Coordinates
        1.0, 1.0, 1.0, -1.0, 1.0, 1.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, // v0-v1-v2-v3 front
        1.0, 1.0, 1.0, 1.0, -1.0, 1.0, 1.0, -1.0, -1.0, 1.0, 1.0, -1.0, // v0-v3-v4-v5 right
        1.0, 1.0, 1.0, 1.0, 1.0, -1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, // v0-v5-v6-v1 up
        -1.0, 1.0, 1.0, -1.0, 1.0, -1.0, -1.0, -1.0, -1.0, -1.0, -1.0, 1.0, // v1-v6-v7-v2 left
        -1.0, -1.0, -1.0, 1.0, -1.0, -1.0, 1.0, -1.0, 1.0, -1.0, -1.0, 1.0, // v7-v4-v3-v2 down
        1.0, -1.0, -1.0, -1.0, -1.0, -1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0  // v4-v7-v6-v5 back
    ]);
    vertices_length = vertices.length;

    // Generate colors - all vertices of each PART of the car the same colour
    var myColours = [];
    while (myColours.length < vertices.length) {
        myColours.push(baseColour[0]);
        myColours.push(baseColour[1]);
        myColours.push(baseColour[2]);
    }
    var colors = new Float32Array(myColours);

    var normals = new Float32Array([    // Normal
        0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0,  // v0-v1-v2-v3 front
        1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0,  // v0-v3-v4-v5 right
        0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0,  // v0-v5-v6-v1 up
        -1.0, 0.0, 0.0, -1.0, 0.0, 0.0, -1.0, 0.0, 0.0, -1.0, 0.0, 0.0,  // v1-v6-v7-v2 left
        0.0, -1.0, 0.0, 0.0, -1.0, 0.0, 0.0, -1.0, 0.0, 0.0, -1.0, 0.0,  // v7-v4-v3-v2 down
        0.0, 0.0, -1.0, 0.0, 0.0, -1.0, 0.0, 0.0, -1.0, 0.0, 0.0, -1.0   // v4-v7-v6-v5 back
    ]);

    // Indices of the vertices
    var indices = new Uint8Array([
        0, 1, 2, 0, 2, 3,    // front
        4, 5, 6, 4, 6, 7,    // right
        8, 9, 10, 8, 10, 11,    // up
        12, 13, 14, 12, 14, 15,    // left
        16, 17, 18, 16, 18, 19,    // down
        20, 21, 22, 20, 22, 23     // back
    ]);

    // Write the vertex property to buffers (coordinates, colors and normals)
    if (!initArrayBuffer(gl, 'a_Position', vertices, 3, gl.FLOAT)) return -1;
    if (!initArrayBuffer(gl, 'a_Color', colors, 3, gl.FLOAT)) return -1;
    if (!initArrayBuffer(gl, 'a_Normal', normals, 3, gl.FLOAT)) return -1;

    // Write the indices to the buffer object
    var indexBuffer = gl.createBuffer();
    if (!indexBuffer) {
        console.log('Failed to create the buffer object');
        return false;
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    return indices.length;
}

function initArrayBuffer(gl, attribute, data, num, type) {
    // Create a buffer object
    var buffer = gl.createBuffer();
    if (!buffer) {
        console.log('Failed to create the buffer object');
        return false;
    }
    // Write date into the buffer object
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    // Assign the buffer object to the attribute variable
    var a_attribute = gl.getAttribLocation(gl.program, attribute);
    if (a_attribute < 0) {
        console.log('Failed to get the storage location of ' + attribute);
        return false;
    }
    gl.vertexAttribPointer(a_attribute, num, type, false, 0, 0);
    // Enable the assignment of the buffer object to the attribute variable
    gl.enableVertexAttribArray(a_attribute);

    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    return true;
}

function drawMainBody(gl, u_ModelMatrix, u_NormalMatrix) {
    setColour(gl, [0.8, 0, 0.5]);
    pushMatrix(modelMatrix);

    // Reset translate and rotate before starting
    modelMatrix.setTranslate(0, 0, 0);
    modelMatrix.setRotate(0, 0, 0);

    // Move car body to main location
    modelMatrix.translate(xDisplacement, 0, zDisplacement);
    // Spin around car body
    modelMatrix.rotate(turning_angle, 0, 1, 0);
    // Scale to shape and size
    modelMatrix.scale(1.4, 0.6, 2);

    drawCuboid(gl, n, u_ModelMatrix, u_NormalMatrix);
    modelMatrix = popMatrix();
}

function drawCab(gl, u_ModelMatrix, u_NormalMatrix) {
    setColour(gl, [0.25, 0.8, 0]);
    pushMatrix(modelMatrix);
    // Reset translate and rotate before starting
    modelMatrix.setTranslate(0, 0, 0);
    modelMatrix.setRotate(0, 0, 0);

    // Move with car body to main location
    modelMatrix.translate(xDisplacement, 0, zDisplacement);
    // Spin around with car
    modelMatrix.rotate(turning_angle, 0, 1, 0);
    // Move model onto car body
    modelMatrix.translate(0, 1.0, 0.45);
    // Scale to size
    modelMatrix.scale(1.3, 0.5, 1.5);

    drawCuboid(gl, n, u_ModelMatrix, u_NormalMatrix);
    modelMatrix = popMatrix();
}

function drawDoor(gl, u_ModelMatrix, u_NormalMatrix, onLeft) {
    // Set the vertex coordinates and color (for the cube)
    if (onLeft) {
        setColour(gl, [0, 0.75, 1]);
    } else {
        setColour(gl, [0, 0, 1]);
    }
    pushMatrix(modelMatrix);

    // Reset translate and rotate before starting
    modelMatrix.setTranslate(0, 0, 0);
    modelMatrix.setRotate(0, 0, 0);

    // Move model around with car
    modelMatrix.translate(xDisplacement, 0.15, zDisplacement);
    // Spin around with car
    modelMatrix.rotate(turning_angle, 0, 1, 0);
    // Move model onto car body
    if (onLeft) {
        modelMatrix.translate(-1.4, 0, 0);
    } else {
        modelMatrix.translate(1.4, 0, 0)
    }
    // Open door if needed
    if (doors_open) {
        // Translate back
        modelMatrix.translate(-0.1, 0, -1);
        if (onLeft) {
            modelMatrix.rotate(-65, 0, 1, 0);
        } else {
            modelMatrix.rotate(65, 0, 1, 0);
        }
        // Translate to origin
        modelMatrix.translate(0.1, 0, 1);
    }
    // Scale to size
    modelMatrix.scale(0.1, 0.4, 1);

    drawCuboid(gl, n, u_ModelMatrix, u_NormalMatrix);
    modelMatrix = popMatrix();
}

function drawWheel(gl, u_ModelMatrix, u_NormalMatrix, wheelNum) {
    switch (wheelNum) {
        case 1:
            setColour(gl, [1, 0.62, 0.5]);
            break;
        case 2:
            setColour(gl, [0.64, 0.16, 0.16]);
            break;
        case 3:
            setColour(gl, [0.5, 0.5, 0]);
            break;
        case 4:
            setColour(gl, [0.46, 0.53, 0.6]);
            break;
    }
    pushMatrix(modelMatrix);

    // Reset translate and rotate before starting
    modelMatrix.setTranslate(0, 0, 0);
    modelMatrix.setRotate(0, 0, 0);

    // Move model around with car
    modelMatrix.translate(xDisplacement, 0.2, zDisplacement);
    // Spin around with car
    modelMatrix.rotate(turning_angle, 0, 1, 0);
    // Move model onto car body
    switch (wheelNum) {
        case 1:
            modelMatrix.translate(-1.4, -1, -1.4);
            break;
        case 2:
            modelMatrix.translate(1.4, -1, -1.4);
            break;
        case 3:
            modelMatrix.translate(-1.4, -1, 1.4);
            break;
        case 4:
            modelMatrix.translate(1.4, -1, 1.4);
            break;
    }
    // Rotate for driving
    modelMatrix.rotate(wheel_rotation_angle, 1, 0, 0);
    // Scale to size
    modelMatrix.scale(0.1, 0.4, 0.4);

    drawCuboid(gl, n, u_ModelMatrix, u_NormalMatrix);
    modelMatrix = popMatrix();
}

function drawFloor(gl, u_ModelMatrix, u_NormalMatrix) {
    setColour(gl, [0.5, 0.5, 0.5]);
    pushMatrix(modelMatrix);

    // Reset translate and rotate before starting
    modelMatrix.setTranslate(0, 0, 0);
    modelMatrix.setRotate(0, 0, 0);

    // Move to correct y level for floor
    modelMatrix.translate(0, -1.5, 0);
    // Scale to shape and size
    modelMatrix.scale(20, 0.1, 20);

    drawCuboid(gl, n, u_ModelMatrix, u_NormalMatrix);
    modelMatrix = popMatrix();
}

function drawCuboid(gl, n, u_ModelMatrix, u_NormalMatrix) {
    // Pass the model matrix to the uniform variable
    gl.uniformMatrix4fv(u_ModelMatrix, false, modelMatrix.elements);

    // Calculate the normal transformation matrix and pass it to u_NormalMatrix
    g_normalMatrix.setInverseOf(modelMatrix);
    g_normalMatrix.transpose();
    gl.uniformMatrix4fv(u_NormalMatrix, false, g_normalMatrix.elements);

    // Draw it
    gl.drawElements(gl.TRIANGLES, n, gl.UNSIGNED_BYTE, 0);
}

function draw(gl, u_ModelMatrix, u_NormalMatrix, u_isLighting, u_isPointLighting) {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.uniform1i(u_isLighting, directionalLighting); // Will apply directional lighting
    gl.uniform1i(u_isPointLighting, pointLighting); // Will apply point lighting

    drawMainBody(gl, u_ModelMatrix, u_NormalMatrix);
    drawCab(gl, u_ModelMatrix, u_NormalMatrix);
    drawDoor(gl, u_ModelMatrix, u_NormalMatrix, true); // Left
    drawDoor(gl, u_ModelMatrix, u_NormalMatrix, false); // Right
    for (var wheelNum = 1; wheelNum <= 4; wheelNum++) { // All 4 wheels
        drawWheel(gl, u_ModelMatrix, u_NormalMatrix, wheelNum);
    }
    drawFloor(gl, u_ModelMatrix, u_NormalMatrix);
}

// TODO as a side project (not for marks): texture the plane with floor.jpg (nostalgic road map mat)
