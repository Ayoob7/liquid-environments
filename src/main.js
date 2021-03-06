import * as RC from "../rendercore/src/RenderCore.js";

let keyboardRotation, keyboardTranslation;
let prevTime = -1, currTime, delta_time;

class App {
	// Global variables
	three_d_model_count;
	augmented_three_d_model_count;

	// Constructor
	constructor(canvas) {
		window.app = this;
		// Canvas
		this.canvas = canvas;
		// Renderer
		this.renderer = new RC.MeshRenderer(this.canvas, RC.WEBGL2);
		this.renderer.clearColor = "#000000FF";
		this.renderer.addShaderLoaderUrls("rendercore/src/shaders");
		this.renderer.addShaderLoaderUrls("src/shaders");
		// GL
		this.gl = this.renderer._gl;

		// Keyboard Input setup
		keyboardRotation = {x: 0, y: 0, z: 0, reset: function() { this.x = 0; this.y = 0; this.z = 0; }};
		keyboardTranslation = {x: 0, y: 0, z: 0, reset: function() { this.x = 0; this.y = 0; this.z = 0; }};

		// Input
		this.keyboardInput = RC.KeyboardInput.instance;
		this.initInputControls();
		this.mouseInput = RC.MouseInput.instance;
		this.mouseInput.setSourceObject(this.canvas);

		// Init
		this.setLoading(true); // Loading message
		// 
		this.initSettings();
		this.initGUI();
		this.initParticles();
		this.initLightVolumes();
		this.initScene();
		this.initRenderQueue();
		this.resize();
		window.addEventListener("resize", () => { this.resize(); }, false);

		this.list_floating_motion = [0,0.1,0.2,0.3,0.4,0.5,0.6];

		// Load resources and start
		this.loadResources(() => { this.start(); });
		//window.requestAnimationFrame(() => { this.update(); });
	}

	// Start of Initialization modules
	initSettings() {
		// Params
		const urlParams = new URLSearchParams(window.location.search);

		// Animation timer
		this.timer = { curr: 0, prev: 0, delta: 0 };
		// FPS
		this.fpsCount = 0;
		this.fpsTime = 0;
		// DOF
		this.dof = {
			// Public
			f: 100.0, // Focal length
			a: 1.0, // Aperture radius
			v0: 4.0, // Distance in focus
			rgbShift: 0.004,
			// Private
			v0_target: 4.0,
			numPasses: 1,
			lastUpdate: 0.0,
			focus: {x: 640, y: 360},
			mousedown: {x: -1, y: -1}
		}		
		this.canvas.addEventListener("mousedown", (event) => {
			this.dof.mousedown.x = event.clientX;
			this.dof.mousedown.y = event.clientY;
		});
		this.canvas.addEventListener("mouseup", (event) => {
			let x = event.clientX, y = event.clientY;
			if (x === this.dof.mousedown.x && y === this.dof.mousedown.y &&
				x >= 0 && x < this.canvas.width && y >= 0 && y < this.canvas.height) {
				this.dof.focus.x = x;
				this.dof.focus.y = this.canvas.height - 1 - y;
			}
		});
		// Liquid
		this.fog = {
			color: new RC.Color(0.01, 0.18, 0.45),
			extinction: new RC.Vector3(0.07, 0.06, 0.05),
			range: new RC.Vector2(-4, 6),
			noise: 1.0, // Noise strength
			strength: new RC.Vector2(2, 0.5),
			lightAtten: new RC.Vector2(0.01, 0.0001),
			lightExtinction: 1.0
		}
		this.fog.color.multiplyScalar(0.5); // (0, 0.3, 0.7)
		this.fog.extinction.multiplyScalar(3.0);

		// Noise
		this.noise = {
			scale: 2.5,
			contrast: 1.0,
			speed: 0.75,
			octaves: 2,
			persistence: 0.5,
			lacunarity: 2.0,
			show: false
		}
		// Lights
		this.lights = {
			shadowRes: parseInt(urlParams.get("shadows") || 1024),
			lookupRes: 256,
			frustum: [],
			point: []
		};
		// Particles
		this.particles = {
			// Static
			res: parseInt(urlParams.get("particles") || 512),
			components: 2, // Number of texels per particle
			// Dynamic
			opacity: 1,
			intensity: 2.5, // Multiplies illumination
			size: 10,
			spawnRadius: 25,
			lifespan: new RC.Vector2(5, 25),
			flowScale: 4.0,
			flowEvolution: 0.1,
			flowSpeed: 0.3,
			// Other
			scene: new RC.Scene()
		}
	}

	initGUI() {
		let params = {
			fcol: this.fog.color.clone().multiplyScalar(255).toArray(),
			pcol: [255, 255, 255],
			add: () => {
				let url = new URL(window.location.href);
				url.searchParams.set("particles", parseInt(this.particles.res));
				url.searchParams.set("shadows", parseInt(this.lights.shadowRes));
				window.location.replace(url);
			}
		};

		this.gui = new dat.GUI();

		// Fog
		let fog = this.gui.addFolder("Fog");

		fog.addColor(params, "fcol").name("Color").onChange(() => {
			this.fog.color.setRGB(params.fcol[0]/255, params.fcol[1]/255, params.fcol[2]/255);
		});
		fog.add(this.fog, "noise", 0, 1).name("Noise strength");

		let extinction = fog.addFolder("Extinction coefficient");
		extinction.add(this.fog.extinction, "x", 0, 1).name("Red");
		extinction.add(this.fog.extinction, "y", 0, 1).name("Green");
		extinction.add(this.fog.extinction, "z", 0, 1).name("Blue");
		extinction.add(this.fog, "lightExtinction", 0, 1).name("Light extinction")

		let layered = fog.addFolder("Layered fog");
		layered.add(this.fog.range, "x", -10, 10).name("Bottom height");
		layered.add(this.fog.range, "y", -10, 10).name("Top height");
		layered.add(this.fog.strength, "x", 0, 4).name("Bottom strength");
		layered.add(this.fog.strength, "y", 0, 4).name("Top strength");
		
		let lightAtten = fog.addFolder("Light attenuation");
		lightAtten.add(this.fog.lightAtten, "x", 0).name("Linear");
		lightAtten.add(this.fog.lightAtten, "y", 0).name("Quadratic");


		// Particles
		let part = this.gui.addFolder("Particles");
		let papp = part.addFolder("Appearance");
		papp.addColor(params, "pcol").name("Color").onChange(() => {
			if (this.particles.mesh !== undefined)
				this.particles.mesh.material.color.setRGB(params.pcol[0]/255, params.pcol[1]/255, params.pcol[2]/255);
		});
		papp.add(this.particles, "opacity", 0, 1).name("Opacity");
		papp.add(this.particles, "intensity", 0, 5).name("Intensity");
		papp.add(this.particles, "size", 0, 64).name("Size");
		let pbeh = part.addFolder("Behavior");
		pbeh.add(this.particles, "spawnRadius", 0, 100).name("Spawn radius");
		pbeh.add(this.particles.lifespan, "x", 0, 20).name("Min lifespan");
		pbeh.add(this.particles.lifespan, "y", 0, 100).name("Max lifespan");
		pbeh.add(this.particles, "flowScale", 0, 20).name("Flow scale");
		pbeh.add(this.particles, "flowEvolution", 0, 1).name("Flow evolution");
		pbeh.add(this.particles, "flowSpeed", 0, 2).name("Flow speed");


		// DOF
		let dof = this.gui.addFolder("Depth of field");
		dof.add(this.dof, "f", 0, 128).name("Focal length");
		dof.add(this.dof, "a", 0, 4).name("Aperture radius");
		dof.add(this.dof, "rgbShift", 0, 0.02).name("RGB shift");

		// Noise
		let noise = this.gui.addFolder("Noise");
		noise.add(this.noise, "scale", 0, 10).name("Scale");
		noise.add(this.noise, "contrast", 0, 5).name("Contrast");
		noise.add(this.noise, "speed", 0, 4).name("Speed");
		noise.add(this.noise, "octaves", 0, 16, 1).name("Octaves");
		noise.add(this.noise, "persistence", 0, 1).name("Persistence");
		noise.add(this.noise, "lacunarity", 1, 10).name("Lacunarity");
		noise.add(this.noise, "show").name("Show texture");

		// Complexity
		let complex = this.gui.addFolder("Complexity");
		complex.add(this.particles, "res", 1, 4096, 1).name("Particle texture");
		complex.add(this.lights, "shadowRes", 1, 4096, 1).name("Shadow maps");
		complex.add(params, "add").name("Click to apply");

	}

	initParticles() {
		let sz = this.particles.res;
		let n_comp = this.particles.components;

		let particleData = new Float32Array(sz * sz * n_comp * 4);
		for (let y = 0; y < sz; ++y) {
			for (let x = 0; x < sz; ++x) {
				let i = y * sz + x;
				// Life
				particleData[n_comp * 4 * i + 4] = 0.0;
				// Random
				particleData[n_comp * 4 * i + 6] = Math.random();
			}
		}

		this.particles.texture = [
			new RC.Texture(particleData,
				RC.Texture.ClampToEdgeWrapping, RC.Texture.ClampToEdgeWrapping,
				RC.Texture.NearestFilter, RC.Texture.NearestFilter,
				RC.Texture.RGBA32F, RC.Texture.RGBA, RC.Texture.FLOAT,
				sz * n_comp, sz),
			new RC.Texture(null,
				RC.Texture.ClampToEdgeWrapping, RC.Texture.ClampToEdgeWrapping,
				RC.Texture.NearestFilter, RC.Texture.NearestFilter,
				RC.Texture.RGBA32F, RC.Texture.RGBA, RC.Texture.FLOAT,
				sz * n_comp, sz)
		];

		// Points
		let vertices = new Float32Array(sz * sz * 3);
		for (let y = 0; y < sz; ++y) {
			for (let x = 0; x < sz; ++x) {
				let i = x + sz * y;
				vertices[3 * i + 0] = (x + 0.5 / n_comp) / sz;
				vertices[3 * i + 1] = (y + 0.5) / sz;
				vertices[3 * i + 2] = 0.0;
			}
		}

		let geo = new RC.Geometry();
		geo.vertices = new RC.BufferAttribute(vertices, 3);

		let mat = new RC.CustomShaderMaterial("particles_draw", { "uvOff": 1.0 / (sz * n_comp) });
		mat.color = new RC.Color(1, 1, 1);
		mat.transparent = true;
		mat.opacity = this.particles.opacity;
		mat.depthWrite = true;
		mat.depthTest = false;
		mat.usePoints = true;
		mat.pointSize = this.particles.size;
		mat.lights = true;
		mat.addMap(this.particles.texture[1]);

		this.particles.mesh = new RC.Mesh(geo, mat);
		this.particles.mesh.renderingPrimitive = RC.POINTS;
		this.particles.mesh.frustumCulled = false;

		this.particles.scene.add(this.particles.mesh);
	}

	initLightVolumes() {
		// Frustum geometry
		let sz = this.lights.shadowRes;
		let vbo = new Float32Array((sz * sz + 1) * 3);
		for (let y = 0; y < sz; ++y) {
			for (let x = 0; x < sz; ++x) {
				let i = x + sz * y;
				vbo[3 * i + 0] = (x + 0.5) / sz;
				vbo[3 * i + 1] = 1.0 - (y + 0.5) / sz;
				vbo[3 * i + 2] = 0.0;
			}
		}
		vbo[sz * sz * 3 + 0] = 0.0;
		vbo[sz * sz * 3 + 1] = 0.0;
		vbo[sz * sz * 3 + 2] = 1.0;

		let ibo = new Uint32Array(((sz-1) * (sz-1) * 2 + 4 * (sz-1)) * 3);
		for (let y = 0; y < sz-1; ++y) {
			for (let x = 0; x < sz-1; ++x) {
				let i = x + (sz-1) * y;
				let j0 = x + sz * y;
				let j1 = x + sz * (y+1);

				ibo[6 * i + 0] = j0;
				ibo[6 * i + 1] = j0+1;
				ibo[6 * i + 2] = j1;

				ibo[6 * i + 3] = j1;
				ibo[6 * i + 4] = j0+1;
				ibo[6 * i + 5] = j1+1;
			}
		}
		let iLast = sz * sz;
		let ioff = 6 * (sz-1) * (sz-1);

		let offset = [0, sz * sz - 1, sz - 1, sz * (sz-1)]; // top left, bot right, top right, bot left
		let increment = [1, -1, sz, -sz];
		for (let j = 0; j < sz-1; ++j) {
			for (let k = 0; k < 4; ++k) {
				ibo[ioff++] = iLast;
				ibo[ioff++] = offset[k] + increment[k];
				ibo[ioff++] = offset[k];
				offset[k] += increment[k];
			}
		}
		if (ioff !== ((sz-1) * (sz-1) * 2 + 4 * (sz-1)) * 3)
			throw "Incorrect number of indices!";

		this.lights.frustumGeo = new RC.Geometry();
		this.lights.frustumGeo.vertices = new RC.BufferAttribute(vbo, 3);
		this.lights.frustumGeo.indices  = new RC.BufferAttribute(ibo, 1);
		//this.lights.frustumGeo.drawWireframe = true;
	}

	initInputControls() {
		this.keyboardInput.addListener(function (pressedKeys) {
			// ROTATIONS
			if (pressedKeys.has(65)) {  // A
				keyboardRotation.y = 1;
			}

			if (pressedKeys.has(68)) {  // D
				keyboardRotation.y = -1;
			}

			if (pressedKeys.has(87)) {  // W
				keyboardRotation.x = 1;
			}

			if (pressedKeys.has(83)) {  // S
				keyboardRotation.x = -1;
			}

			if (pressedKeys.has(81)) {  // Q
				keyboardRotation.z = 1;
			}

			if (pressedKeys.has(69)) {  // E
				keyboardRotation.z = -1;
			}


			// TRANSLATIONS
			if (pressedKeys.has(39)) {  // RIGHT - Right
				keyboardTranslation.x = 1;
			}

			if (pressedKeys.has(37)) {  // LEFT - Left
				keyboardTranslation.x = -1;
			}

			if (pressedKeys.has(40)) {  // DOWN - Backward
				keyboardTranslation.z = 1;
			}

			if (pressedKeys.has(38)) {  // UP - Forward
				keyboardTranslation.z = -1;
			}

			if (pressedKeys.has(73)) {  // I - Upward
				keyboardTranslation.y = 1;
			}

			if (pressedKeys.has(74)) {  // J - Downward
				keyboardTranslation.y = -1;
			}
		});
	}

	addFrustumLight(position, target, color) {
		if (position === undefined) position = new RC.Vector3(0, 0, 0);
		if (target === undefined) target = new RC.Vector3(0, 0, -1).add(position);
		if (color === undefined) color = new RC.Color(1, 1, 1);

		let l = {
			intensity: 1.0,
			beta: 0.01,
			volumeIntensity: 1.0,
			color: color,
			camera: new RC.PerspectiveCamera(90, 1.0, 0.1, 500.0),
			texture: new RC.Texture(
				null, RC.Texture.RepeatWrapping, RC.Texture.RepeatWrapping,	RC.Texture.NearestFilter, RC.Texture.NearestFilter,
				RC.Texture.DEPTH_COMPONENT24, RC.Texture.DEPTH_COMPONENT, RC.Texture.UNSIGNED_INT, this.lights.shadowRes, this.lights.shadowRes),
			scene: new RC.Scene()
		};
		l.camera.position = position;
		l.camera.lookAt(target, new RC.Vector3(0.0, 1.0, 0.0));
		l.camera.updateMatrixWorld();
		l.camera.matrixWorldInverse.getInverse(l.camera.matrixWorld);
		
		l.PMatInv = new RC.Matrix4().getInverse(l.camera.projectionMatrix);

		let mat = new RC.CustomShaderMaterial("light_volume", {});
		mat.color = color;
		mat.depthWrite = true;
		mat.depthTest = false;
		mat.lights = false;
		mat.transparent = true;
		mat.side = RC.FRONT_AND_BACK_SIDE;
		mat.addMap(l.texture);
		
		l.mesh = new RC.Mesh(this.lights.frustumGeo, mat);
		l.mesh.frustumCulled = false;

		l.scene.add(l.mesh);
		this.lights.frustum.push(l);
		return l;
	}

	createPhongMat(color, specular, shininess) {
		if (color === undefined) color = new RC.Color(1, 1, 1);
		if (specular === undefined) specular = new RC.Color(1, 1, 1);
		if (shininess === undefined) shininess = 1.0;

		let mat = new RC.CustomShaderMaterial("phong_liquid", {});
		mat.color = color;
		mat.specular = specular;
		mat.shininess = shininess;
		return mat;
	}

	createTextureForStructures(color, specular, shininess) {
		if (color === undefined) color = new RC.Color(0.5, 0.5, .1);
		if (specular === undefined) specular = new RC.Color(1, 1, 1);
		if (shininess === undefined) shininess = 1.0;

		// let mat = new RC.MeshPhongMaterial();
		let mat = new RC.MeshBasicMaterial();
		mat.color = color;
		// mat.specular = specular;
		// mat.shininess = shininess;
		mat.transparent = true;
		mat.opacity = 0.5;
		return mat;
	}

	initScene() {
		/// Main scene
		this.scene = new RC.Scene();

		this.camera = new RC.PerspectiveCamera(60, this.canvas.width / this.canvas.height, 0.1, 1000);
		this.camera.position = new RC.Vector3(0, 2.5, 6);
		this.camera.lookAt(new RC.Vector3(0, 0, 0), new RC.Vector3(0, 1, 0));
		this.PMatInv = new RC.Matrix4().getInverse(this.camera.projectionMatrix);
		
		this.cameraManager = new RC.CameraManager();
		this.cameraManager.addFullOrbitCamera(this.camera, new RC.Vector3(0, 1.0, 0));
		this.cameraManager.activeCamera = this.camera;
		/*this.cameraManager = new RC.CameraManager();
		this.cameraManager.addFullOrbitCamera(this.camera, new RC.Vector3(0, 0, 0));
		//this.cameraManager.camerasControls[camera._uuid].keyMap = keyMap;
		this.cameraManager.activeCamera = this.camera;*/


		// Volumetric lights
		//this.addFrustumLight(new RC.Vector3(-4, 10, -20), new RC.Vector3(0, 0, 0), new RC.Color(0.8, 0.8, 0.2)).intensity = 0.7;
		//this.addFrustumLight(new RC.Vector3(10, 10, 10),  new RC.Vector3(0, 0, 0), new RC.Color(1.0, 0.2, 0.5)).intensity = 0.9;
		//this.addFrustumLight(new RC.Vector3(20, 40, -8),  new RC.Vector3(0, 0, 0), new RC.Color(0.9, 0.85, 1.0)).intensity = 1.8;
		//this.lights.frustum[2].volumeIntensity = 8000.0

		//this.addFrustumLight(new RC.Vector3(10, 10, 10),  new RC.Vector3(0, 0, 0), new RC.Color(1, 1, 1)).intensity = 0;
		this.a = this.addFrustumLight(new RC.Vector3(-4, 6, -10), new RC.Vector3(0, 0, 0), new RC.Color(1, 1, 1)); //.volumeIntensity = 0;
		this.b = this.addFrustumLight(new RC.Vector3(10, 10, 10),  new RC.Vector3(0, 0, 0), new RC.Color(1, 1, 1)); //.volumeIntensity = 0;
		this.c = this.addFrustumLight(new RC.Vector3(6, 4, 0),  new RC.Vector3(0, 0, 0), new RC.Color(1, 1, 1)); //.volumeIntensity = 0;

		// RenderCore Lights
		// this.dLight = new RC.DirectionalLight(new RC.Color("#FFFFFF"), 1.0);
		// this.dLight.position = new RC.Vector3(1.0, 0.5, 0.8);

		// this.pLight = new RC.PointLight(new RC.Color("#FFFFFF"), 1.0);
		// this.pLight.position = new RC.Vector3(-4.0, 10.0, -20.0);
		// this.pLight2 = new RC.PointLight(new RC.Color("#FFFFFF"), 1.0);
		// this.pLight2.position = new RC.Vector3(10.0, 10.0, 10.0);
		this.aLight = new RC.AmbientLight(new RC.Color("#FFFFFF"), 0.03);

		//this.pLight.add(new RC.Cube(1.0, this.pLight.color));
		//this.pLight2.add(new RC.Cube(1.0, this.pLight.color));

		this.lightsRC = [/*this.pLight, this.pLight2,*/ this.aLight]; // , this.dLight];
		for (let l of this.lightsRC)
			this.scene.add(l);
		// for (let l of this.lights)
		// 	this.particleScene.add(l);


		// Plane
		let plane = new RC.Quad({x: -64, y: 64}, {x: 64, y: -64}, this.createPhongMat());
		plane.material.side = RC.FRONT_AND_BACK_SIDE;

		let pixelData = new Uint8Array([
			230, 230, 190, 255
		]);
		let texture = new RC.Texture(pixelData, RC.Texture.ClampToEdgeWrapping, RC.Texture.ClampToEdgeWrapping,
			RC.Texture.NearestFilter, RC.Texture.NearestFilter,
			RC.Texture.RGBA, RC.Texture.RGBA, RC.Texture.UNSIGNED_BYTE, 1, 1);

		plane.translateY(0);
		plane.rotateX(-Math.PI * 0.5);

		plane.material.addMap(texture);
		this.scene.add(plane);

		let plane2 = new RC.Quad({x: -64, y: 64}, {x: 64, y: -64}, this.createPhongMat());
		plane2.material.side = RC.FRONT_AND_BACK_SIDE;
		//plane2.material.addMap(texture);
		plane2.translateZ(-35);
		
		this.scene.add(plane2);


		// Display particle textures
		let q1 = new RC.Quad({x: -1, y: -.5}, {x: 1, y: .5}, new RC.MeshBasicMaterial());
		q1.position = new RC.Vector3(-3,0,-2);
		q1.material.side = RC.Material.FRONT_AND_BACK_SIDE;
		q1.material.color = new RC.Color("#FFFFFF");
		q1.material.addMap(this.particles.texture[0]);
		//this.scene.add(q1);

		let q2 = new RC.Quad({x: -1, y: -.5}, {x: 1, y: .5}, new RC.MeshBasicMaterial());
		q2.position = new RC.Vector3(3,0,-2);
		q2.material.side = RC.Material.FRONT_AND_BACK_SIDE;
		q2.material.color = new RC.Color("#FFFFFF");
		q2.material.addMap(this.particles.texture[1]);
		//this.scene.add(q2);

		this.q1 = q1;
		this.q2 = q2;
	}

	initRenderQueue() {

		let RGBA16F_LINEAR = {
			wrapS: RC.Texture.ClampToEdgeWrapping,
			wrapT: RC.Texture.ClampToEdgeWrapping,
			minFilter: RC.Texture.LinearFilter,
			magFilter: RC.Texture.LinearFilter,
			internalFormat: RC.Texture.RGBA16F, // WASTE OF MEMORY!!!
			format: RC.Texture.RGBA,
			type: RC.Texture.FLOAT
		};

		// NOISE
		this.perlinNoisePass = new RC.RenderPass(
			RC.RenderPass.POSTPROCESS,
			(textureMap, additionalData) => {},
			(textureMap, additionalData) => {
				let mat = new RC.CustomShaderMaterial("perlin_noise", {
					"uRes": [this.canvas.width, this.canvas.height],
					"uTime": this.timer.curr,
					"uScale": this.canvas.height / this.noise.scale,
					"uContrast": this.noise.contrast,
					"uSpeed": this.noise.speed,
					"uOctaves": this.noise.octaves,
					"uPersistence": this.noise.persistence,
					"uLacunarity": this.noise.lacunarity
				});
				mat.ligths = false;
				return { material: mat, textures: [] };
			},
			RC.RenderPass.TEXTURE,
			{ width: this.canvas.width, height: this.canvas.height },
			"dummy",
			[
				{ id: "perlinNoise", textureConfig: RGBA16F_LINEAR}
			]
		);
		// PARTICLES UPDATE
		this.particleUpdatePass = new RC.RenderPass(
			RC.RenderPass.POSTPROCESS,
			(textureMap, additionalData) => {},
			(textureMap, additionalData) => {
				let mat = new RC.CustomShaderMaterial("particles_update", {
					"uRes": [this.particles.texture[0].width, this.particles.texture[0].height],
					"uDT": this.timer.delta,
					"uTime": this.timer.curr,
					"uSeed": Math.random(),
					"uSpawnRadius": this.particles.spawnRadius,
					"uLifespan": this.particles.lifespan.toArray(),
					"uFlowScale": this.particles.flowScale,
					"uFlowEvolution": this.particles.flowEvolution,
					"uFlowSpeed": this.particles.flowSpeed,
					"uCameraPos": this.camera.position.toArray(),
					"uNumComp": this.particles.components
				});
				mat.ligths = false;
				return { material: mat, textures: [textureMap.particlesRead] };
			},
			RC.RenderPass.TEXTURE,
			{ width: this.particles.texture[0].width, height: this.particles.texture[0].height },
			"dummy1",
			[{
				id: "particlesWrite",
				textureConfig: {
					wrapS: this.particles.texture[0].wrapS,
					wrapT: this.particles.texture[0].wrapT,
					minFilter: this.particles.texture[0].minFilter,
					magFilter: this.particles.texture[0].magFilter,
					internalFormat: this.particles.texture[0].internalFormat,
					format: this.particles.texture[0].format,
					type: this.particles.texture[0].type
				}
			}]
		);
		// PARTICLES DRAW
		this.particleDrawPass = new RC.RenderPass(
			RC.RenderPass.BASIC,
			(textureMap, additionalData) => {
				this.particles.mesh.material.addMap(textureMap.mainDepthDist);
				this.particles.mesh.material.addMap(textureMap.perlinNoise);
				// Shadow maps
				for (let l of this.lights.frustum)
					this.particles.mesh.material.addMap(l.texture);
				this.particles.mesh.material.addSBValue("NUM_FRUSTUM_LIGHTS", this.lights.frustum.length);
			},
			(textureMap, additionalData) => {
				this.particles.mesh.material.opacity = this.particles.opacity;
				this.particles.mesh.material.pointSize = this.particles.size;
				this.particles.mesh.material.setUniform("uIntensity", this.particles.intensity);
				this.particles.mesh.material.setUniform("uRes", [this.canvas.width, this.canvas.height]);
				this.particles.mesh.material.setUniform("uCameraRange", [this.camera.near, this.camera.far]);
				this.particles.mesh.material.setUniform("uLiquidColor", this.fog.color.toArray());
				this.particles.mesh.material.setUniform("uLiquidAtten", this.fog.extinction.toArray());
				this.particles.mesh.material.setUniform("uLightAtten", this.fog.lightAtten.toArray());
				this.particles.mesh.material.setUniform("uFogRange", this.fog.range.toArray());
				this.particles.mesh.material.setUniform("uFogStrength", this.fog.strength.toArray());
				this.particles.mesh.material.setUniform("uCameraHeight", this.camera.position.y);
				this.particles.mesh.material.setUniform("uNoiseStrength", this.fog.noise);
				this.particles.mesh.material.setUniform("uLightExtinction", this.fog.lightExtinction);
				
				this.particles.mesh.material.setUniform("f", this.dof.f);
				this.particles.mesh.material.setUniform("a", this.dof.a);
				this.particles.mesh.material.setUniform("v0", this.dof.v0);

				// for (let l of this.lights)
				// 	this.particleScene.add(l);

				return { scene: this.particles.scene, camera: this.camera };
			},
			RC.RenderPass.TEXTURE,
			{ width: this.canvas.width, height: this.canvas.height },
			"particleDepth",
			[{
				id: "particleColor",
				textureConfig: RC.RenderPass.DEFAULT_RGBA_TEXTURE_CONFIG
			}]
		);
		// SHADOW MAP
		this.shadowMapPasses = [];
		for (let i = 0; i < this.lights.frustum.length; ++i) {
			this.shadowMapPasses.push(new RC.RenderPass(
				RC.RenderPass.BASIC,
				(textureMap, additionalData) => {},
				(textureMap, additionalData) => {
					for (let object of this.sceneObjects) {
						object.material = object.material_temp;
						object.material.setUniform("uLightPos", this.lights.frustum[i].camera.position.toArray());
						object.material.setUniform("uFarPlane", this.lights.frustum[i].camera.far);
					}
					return { scene: this.scene, camera: this.lights.frustum[i].camera };
				},
				RC.RenderPass.TEXTURE,
				{ width: this.lights.shadowRes, height: this.lights.shadowRes },
				"shadowMap" + i,
				[
					//{ id: "shadowColor" + i, textureConfig: RC.RenderPass.DEFAULT_RGBA_TEXTURE_CONFIG }
				]
			));
		}
		// MAIN
		this.mainRenderPass = new RC.RenderPass(
			RC.RenderPass.BASIC,
			(textureMap, additionalData) => {},
			(textureMap, additionalData) => {
				for (let object of this.sceneObjects) {
					object.material = object.material_main;
					
					if (object.material.programName === "custom_phong_liquid") {                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       
						object.material.setUniform("uMMat", object.matrix.toArray());
						object.material.setUniform("uFogRange", this.fog.range.toArray());
						object.material.setUniform("uFogStrength", this.fog.strength.toArray());
						object.material.setUniform("uLiquidColor", this.fog.color.toArray());
						object.material.setUniform("uLiquidAtten", this.fog.extinction.toArray());
						object.material.setUniform("uLightAtten", this.fog.lightAtten.toArray());
						object.material.setUniform("uNoiseStrength", this.fog.noise);
						object.material.setUniform("uLightExtinction", this.fog.lightExtinction);
					}
				}


				for (let i = 0; i < this.lights.frustum.length; ++i) {
					let prefix = "uFrustumLights[" + i + "].";
					let light = this.lights.frustum[i];

					let lightMatrix = new RC.Matrix4().multiplyMatrices(light.camera.projectionMatrix, light.camera.matrixWorldInverse);
					// // Apply light intensity
					// let lightColor = new RC.Vector3().copy(light.color).multiplyScalar(light.intensity);
					// Light position in view space
					let lightPos = new RC.Vector3().copy(light.camera.position).applyMatrix4(this.camera.matrixWorldInverse);
					let lightColor = new RC.Color().copy(light.color).multiplyScalar(light.intensity);

					for (let object of this.sceneObjects) {
						if (object.material.programName === "custom_phong_liquid") {
							object.material.setUniform(prefix + "matrix", lightMatrix.toArray());
							object.material.setUniform(prefix + "farPlane", light.camera.far);
							object.material.setUniform(prefix + "color", lightColor.toArray());
							object.material.setUniform(prefix + "position", lightPos.toArray());
							object.material.setUniform(prefix + "worldHeight", light.camera.position.y);
						}
					}

					// Also set particle mesh uniforms to save CPU cycles
					this.particles.mesh.material.setUniform(prefix + "matrix", lightMatrix.toArray());
					this.particles.mesh.material.setUniform(prefix + "farPlane", light.camera.far);
					this.particles.mesh.material.setUniform(prefix + "color", lightColor.toArray());
					this.particles.mesh.material.setUniform(prefix + "position", lightPos.toArray());
					this.particles.mesh.material.setUniform(prefix + "worldHeight", light.camera.position.y);
				}

				// for (let l of this.lights)
				// 	this.scene.add(l);

				return { scene: this.scene, camera: this.camera };
			},
			RC.RenderPass.TEXTURE,
			{ width: this.canvas.width, height: this.canvas.height },
			"mainDepthBuf",
			[
				{ id: "mainColor", textureConfig: RC.RenderPass.DEFAULT_RGBA_TEXTURE_CONFIG }
			]
		);
		// AIRLIGHT LOOKUP
		this.airlightLookupPass = new RC.RenderPass(
			RC.RenderPass.POSTPROCESS,
			(textureMap, additionalData) => {},
			(textureMap, additionalData) => {
				let mat = new RC.CustomShaderMaterial("airlight_lookup", {
					"uLookupSize": this.lights.lookupRes
				});
				mat.ligths = false;
				return { material: mat, textures: []};
			},
			RC.RenderPass.TEXTURE,
			{ width: this.lights.lookupRes, height: this.lights.lookupRes },
			"dummy123",
			[
				{ id: "airlightLookup", textureConfig: RGBA16F_LINEAR }
			]
		);
		// LIGHT VOLUME
		this.lightVolumePasses = [];
		for (let i = 0; i < this.lights.frustum.length; ++i) {
			let light = this.lights.frustum[i];
			this.lightVolumePasses.push(new RC.RenderPass(
				RC.RenderPass.BASIC,
				(textureMap, additionalData) => {
					//light.mesh.material.addMap(textureMap.mainDepthBuf);
					light.mesh.material.addMap(textureMap.mainDepthDist);
					light.mesh.material.addMap(textureMap.airlightLookup);
				},
				(textureMap, additionalData) => {
					let lightDir = new RC.Vector3().subVectors(this.camera.position, light.camera.position);
					let lightDist = lightDir.length();
					if (lightDist > 0.0)
						lightDir.divideScalar(lightDist);
					let lightColor = new RC.Color().copy(light.color).multiplyScalar(light.intensity);

					let VPMatInv = new RC.Matrix4().multiplyMatrices(light.camera.matrixWorld, light.PMatInv);
					light.mesh.material.setUniform("uVPMatInv", VPMatInv.toArray());
					light.mesh.material.setUniform("uLightPos", light.camera.position.toArray());
					light.mesh.material.setUniform("uCameraPos", this.camera.position.toArray());
					light.mesh.material.setUniform("uLightDir", lightDir.toArray());
					light.mesh.material.setUniform("uLightDist", lightDist);
					light.mesh.material.setUniform("uLightColor", lightColor.toArray());
					light.mesh.material.setUniform("uLookupSize", this.lights.lookupSize);
					light.mesh.material.setUniform("uFarPlane", light.camera.far);
					light.mesh.material.setUniform("uResInv", [1.0 / this.canvas.width, 1.0 / this.canvas.height]);
					light.mesh.material.setUniform("uSeed", Math.random());
					light.mesh.material.setUniform("uBeta", light.beta);
					light.mesh.material.setUniform("uIntensity", light.volumeIntensity);
					
					return { scene: light.scene, camera: this.camera };
				},
				RC.RenderPass.TEXTURE,
				{ width: this.canvas.width, height: this.canvas.width },
				"dummy",
				[
					{ id: "lightVolume" + i, textureConfig: RGBA16F_LINEAR }
				]
			));
		}
		this.lightVolumePass = new RC.RenderPass(
			RC.RenderPass.POSTPROCESS,
			(textureMap, additionalData) => {},
			(textureMap, additionalData) => {
				let mat = new RC.CustomShaderMaterial("light_volume_blend", {});
				mat.ligths = false;
				let tex = [];
				for (let i = 0; i < this.lights.frustum.length; ++i)
					tex.push(textureMap["lightVolume" + i]);
				return { 
					material: mat,
					textures: tex
				};
			},
			RC.RenderPass.TEXTURE,
			{ width: this.canvas.width, height: this.canvas.width },
			"dummy",
			[
				{ id: "lightVolume", textureConfig: RGBA16F_LINEAR }
			]
		);
		// DEPTH
		this.depthPass = new RC.RenderPass(
			RC.RenderPass.POSTPROCESS,
			(textureMap, additionalData) => {},
			(textureMap, additionalData) => {
				let VPMatInv = new RC.Matrix4().multiplyMatrices(this.camera.matrixWorld, this.PMatInv);

				let mat = new RC.CustomShaderMaterial("depth_distance", {
					"uVPMatInv": VPMatInv.toArray(),
					"uCameraPos": this.camera.position.toArray(),
					"uCameraDir": new RC.Vector3(0,0,-1).applyEuler(this.camera.rotation).toArray(),
					"uCameraRange": [this.camera.near, this.camera.far]
				});
				mat.ligths = false;
				return { 
					material: mat,
					textures: [textureMap.mainDepthBuf]
				};
			},
			RC.RenderPass.TEXTURE,
			{ width: this.canvas.width, height: this.canvas.height },
			"dummy",
			[
				{ id: "mainDepthDist", textureConfig: RGBA16F_LINEAR }
			]
		);
		// DOF
		this.dofDownsamplePass = new RC.RenderPass(
			RC.RenderPass.POSTPROCESS,
			(textureMap, additionalData) => {},
			(textureMap, additionalData) => {
				let mat = new RC.CustomShaderMaterial("dof_downsample_near", {
					"uSrcResInv": [1.0 / this.canvas.width, 1.0 / this.canvas.height],
					"f": this.dof.f,
					"a": this.dof.a,
					"v0": this.dof.v0
				});
				mat.ligths = false;
				return { 
					material: mat,
					textures: [textureMap.water, textureMap.mainDepthDist, textureMap.perlinNoise]
				};
			},
			RC.RenderPass.TEXTURE,
			{ width: this.canvas.width * 0.25, height: this.canvas.height * 0.25 },
			"dummy4x4",
			[
				{ id: "downsampled", textureConfig: RGBA16F_LINEAR }
			]
		);
		this.cocPass = new RC.RenderPass(
			RC.RenderPass.POSTPROCESS,
			(textureMap, additionalData) => {},
			(textureMap, additionalData) => {
				let mat = new RC.CustomShaderMaterial("dof_coc_near", {});
				mat.ligths = false;
				return { 
					material: mat,
					textures: [textureMap.downsampled, textureMap.blurred]
				};
			},
			RC.RenderPass.TEXTURE,
			{ width: this.canvas.width * 0.25, height: this.canvas.height * 0.25 },
			"dummy4x4",
			[
				{ id: "coc_near", textureConfig: RGBA16F_LINEAR }
			]
		);
		this.dofSmallBlurPass = new RC.RenderPass(
			RC.RenderPass.POSTPROCESS,
			(textureMap, additionalData) => {},
			(textureMap, additionalData) => {
				let mat = new RC.CustomShaderMaterial("dof_small_blur", {
					"uResInv": [4.0 / this.canvas.width, 4.0 / this.canvas.height]
				});
				mat.ligths = false;
				return { 
					material: mat,
					textures: [textureMap.coc_near]
				};
			},
			RC.RenderPass.TEXTURE,
			{ width: this.canvas.width * 0.25, height: this.canvas.height * 0.25 },
			"dummy4x4",
			[
				{ id: "small_blur", textureConfig: RGBA16F_LINEAR }
			]
		);
		this.dofPass = new RC.RenderPass(
			RC.RenderPass.POSTPROCESS,
			(textureMap, additionalData) => {},
			(textureMap, additionalData) => {
				let mat = new RC.CustomShaderMaterial("dof", {	
					"uResInv": [1.0 / this.canvas.width, 1.0 / this.canvas.height],
					"f": this.dof.f,
					"a": this.dof.a,
					"v0": this.dof.v0
				});
				mat.ligths = false;
				return { 
					material: mat,
					textures: [textureMap.water, textureMap.mainDepthDist, textureMap.perlinNoise, textureMap.blurred, textureMap.small_blur]
				};
			},
			RC.RenderPass.TEXTURE,
			{ width: this.canvas.width, height: this.canvas.height },
			"dummy",
			[
				{ id: "dof", textureConfig: RGBA16F_LINEAR }
			]
		);
		// GAUSS
		this.gaussPassVert = [];
		this.gaussPassHor  = [];
		for (let iPass = 0; iPass < this.dof.numPasses; ++iPass) {
			this.gaussPassHor.push(new RC.RenderPass(
				RC.RenderPass.POSTPROCESS,
				(textureMap, additionalData) => {},
				(textureMap, additionalData) => {
					let mat = new RC.CustomShaderMaterial("gaussian_blur", { "horizontal": true });
					mat.ligths = false;
					return { 
						material: mat,
						textures: [iPass == 0 ? textureMap.downsampled : textureMap.blurred]
					};
				},
				RC.RenderPass.TEXTURE,
				{ width: this.canvas.width * 0.25, height: this.canvas.height * 0.25 },
				"dummy4x4",
				[
					{ id: "blurred_hor", textureConfig: RGBA16F_LINEAR }
				]
			));
			this.gaussPassVert.push(new RC.RenderPass(
				RC.RenderPass.POSTPROCESS,
				(textureMap, additionalData) => {},
				(textureMap, additionalData) => {
					let mat = new RC.CustomShaderMaterial("gaussian_blur", { "horizontal": false });
					mat.ligths = false;
					return { 
						material: mat,
						textures: [textureMap.blurred_hor]
					};
				},
				RC.RenderPass.TEXTURE,
				{ width: this.canvas.width * 0.25, height: this.canvas.height * 0.25 },
				"dummy4x4",
				[
					{ id: "blurred", textureConfig: RGBA16F_LINEAR }
				]
			));
		}
		// WATER
		this.waterRenderPass = new RC.RenderPass(
			RC.RenderPass.POSTPROCESS,
			(textureMap, additionalData) => {},
			(textureMap, additionalData) => {
				let mat = new RC.CustomShaderMaterial("water", {
					"uLiquidColor": this.fog.color.toArray(),
					"uLiquidAtten": this.fog.extinction.toArray(),
					"uFogRange": this.fog.range.toArray(),
					"uFogStrength": this.fog.strength.toArray(),
					"uCameraHeight": this.camera.position.y,
					"uNoiseStrength": this.fog.noise
				});
				mat.ligths = false;
				return { 
					material: mat,
					textures: [
						textureMap.mainColor,
						textureMap.mainDepthDist,
						textureMap.particleColor,
						textureMap.perlinNoise,
						textureMap.lightVolume
					]
				};
			},
			RC.RenderPass.TEXTURE,
			{ width: this.canvas.width, height: this.canvas.height },
			"dummy",
			[
				{ id: "water", textureConfig: RC.RenderPass.DEFAULT_RGBA_TEXTURE_CONFIG }
			]
		);

		// POST
		this.postPass = new RC.RenderPass(
			RC.RenderPass.POSTPROCESS,
			(textureMap, additionalData) => {},
			(textureMap, additionalData) => {
				let mat = new RC.CustomShaderMaterial("post", {
					"uRGBShift": this.dof.rgbShift
				});
				mat.addSBFlag("RGB_SHIFT");
				mat.ligths = false;
				return { 
					material: mat,
					textures: [textureMap.dof, textureMap.particleColor]
				};
			},
			RC.RenderPass.TEXTURE,
			{ width: this.canvas.width, height: this.canvas.height },
			"dummy",
			[
				{ id: "final", textureConfig: RC.RenderPass.DEFAULT_RGBA_TEXTURE_CONFIG }
			]
		);
		// DISPLAY
		this.displayPass = new RC.RenderPass(
			RC.RenderPass.POSTPROCESS,
			(textureMap, additionalData) => {},
			(textureMap, additionalData) => {
				let mat = new RC.CustomShaderMaterial("texture", {});
				mat.ligths = false;
				return {
					material: mat,
					textures: [this.noise.show ? textureMap.perlinNoise : textureMap.final]
				};
			},
			RC.RenderPass.SCREEN,
    		{ width: this.canvas.width, height: this.canvas.height }
		);

		this.renderQueue = new RC.RenderQueue(this.renderer);

		this.renderQueue.addTexture("particlesRead", this.particles.texture[0]);
		this.renderQueue.addTexture("particlesWrite", this.particles.texture[1]);
		for (let i = 0; i < this.lights.frustum.length; ++i)
			this.renderQueue.addTexture("shadowMap" + i, this.lights.frustum[i].texture);

		this.renderQueue.pushRenderPass(this.perlinNoisePass);

		for (let pass of this.shadowMapPasses)
			this.renderQueue.pushRenderPass(pass);

		this.renderQueue.pushRenderPass(this.mainRenderPass);
		this.renderQueue.pushRenderPass(this.depthPass);

		this.renderQueue.pushRenderPass(this.airlightLookupPass);
		for (let pass of this.lightVolumePasses)
			this.renderQueue.pushRenderPass(pass);
		this.renderQueue.pushRenderPass(this.lightVolumePass);

		this.renderQueue.pushRenderPass(this.particleUpdatePass);
		this.renderQueue.pushRenderPass(this.particleDrawPass);

		this.renderQueue.pushRenderPass(this.waterRenderPass);

		this.renderQueue.pushRenderPass(this.dofDownsamplePass);
		for (let i = 0; i < this.dof.numPasses; ++i) {
			this.renderQueue.pushRenderPass(this.gaussPassHor[i]);
			this.renderQueue.pushRenderPass(this.gaussPassVert[i]);
		}
		this.renderQueue.pushRenderPass(this.cocPass);
		this.renderQueue.pushRenderPass(this.dofSmallBlurPass);
		this.renderQueue.pushRenderPass(this.dofPass);

		this.renderQueue.pushRenderPass(this.postPass);

		this.renderQueue.pushRenderPass(this.displayPass);
	}
	// End of Initialization modules

	/* ================== Most of my work here ================== */

	// Loading objects
	loadResources(callback) {
		this.manager = new RC.LoadingManager();
		this.objLoader = new RC.ObjLoader(this.manager);
		this.imageLoader = new RC.ImageLoader(this.manager);

		let urls = [];
		/*for(var x = 1; x <= 14; x++) {
			urls.push("data/models/mitos/mito_"+x+"_out.obj");
		}*/
		// Mitochondrias
		for(var x = 1; x <= 15; x++) {
			urls.push("data/models/mito_new/structure_id_"+x+".obj");
		}
		// Endolysosomes
		var end = 'structure_id_405.obj,structure_id_334.obj,structure_id_336.obj,structure_id_333.obj,structure_id_535.obj,structure_id_395.obj,structure_id_502.obj,structure_id_375.obj,structure_id_390.obj,structure_id_660.obj,structure_id_703.obj,structure_id_623.obj,structure_id_359.obj,structure_id_608.obj,structure_id_618.obj,structure_id_595.obj,structure_id_552.obj'
		for (var s of end.split(",")) {
			urls.push("data/models/endolysosomes_new/"+s)
		}
		// Fusiform Vesicles
		var fv = 'structure_id_816.obj,structure_id_815.obj,structure_id_818.obj,structure_id_822.obj,structure_id_820.obj,structure_id_821.obj'
		for (var s of fv.split(",")) {
			urls.push("data/models/fusiform_vesicles_new/"+s)
		}

		const makeRepeated = (arr, repeats) =>
			[].concat(...Array.from({ length: repeats }, () => arr));

		let augmented_dataset = makeRepeated(urls, 5)

		function shuffleArray(array) {
			for (var i = array.length - 1; i > 0; i--) {
				var j = Math.floor(Math.random() * (i + 1));
				var temp = array[i];
				array[i] = array[j];
				array[j] = temp;
			}
		}
		shuffleArray(urls)
		shuffleArray(augmented_dataset)

		this.augmented_three_d_model_count = augmented_dataset.length;
		this.three_d_model_count = urls.length;
		this.resources = [];

		/*for (let i = 0; i < urls.length; ++i) {
			this.resources[i] = false;
			this.objLoader.load(urls[i], (obj) => {
				this.resources[i] = obj;

			});
		}*/

		for (let i = 0; i < augmented_dataset.length; ++i) {
			this.resources[i] = false;
			this.objLoader.load(augmented_dataset[i], (obj) => {
				this.resources[i] = obj;

			});
		}

		let wait = (function() {
			if (this.resources.every((el) => { return el !== false; })) {
				this.setupObjectsInHemiSphere();
				callback();
			} else {
				setTimeout(wait, 500);
			}
		}).bind(this);
		wait();
	}

	// Setting up different objects here
	setupResources() {
		let xorshift32_state = new Uint32Array([0.4 * 0xFFFFFFFF]);
		function xorshift32() {
			const x = xorshift32_state;
			x[0] ^= x[0] << 13;
			x[0] ^= x[0] >> 17;
			x[0] ^= x[0] << 5;
			return x[0] / 0xFFFFFFFF;
		}


		let steps = this.three_d_model_count
		let radius = 4
		let centerX = 0
		let centerY = 0

		let x_val = 0
		let y_val = 0
		let z_val = 0

		// Structures
		for(var x = 0; x < steps; x++) {

			x_val = centerX + radius * Math.cos(2 * Math.PI * x / steps);
			z_val = centerY + radius * Math.sin(2 * Math.PI * x / steps);
			y_val = Math.floor(Math.random() * 4) + 1
			for (let obj of this.resources[x]) {
				obj.scale.multiplyScalar(0.01);
				obj.position = new RC.Vector3(x_val, y_val, z_val);
				obj.material.shininess = 16;
				obj.material = this.createTextureForStructures();
				this.scene.add(obj);

			}
		}
	}

	intersectCollision(a, b) {
		let sphere_x = a[0]
		let sphere_y = a[1]
		let sphere_z = a[2]
		let sphere_radius = a[3]

		let other_sphere_x = b[0]
		let other_sphere_y = b[1]
		let other_sphere_z = b[2]
		let other_sphere_radius = b[3]
		var distance = Math.sqrt((sphere_x - other_sphere_x) * (sphere_x - other_sphere_x) +
			(sphere_y - other_sphere_y) * (sphere_y - other_sphere_y) +
			(sphere_z - other_sphere_z) * (sphere_z - other_sphere_z));

		return distance - (sphere_radius + other_sphere_radius);
	}


	setupObjectsInCircles() {

		let steps = this.augmented_three_d_model_count
		let radius = 4
		let centerX = 0
		let centerY = 0

		let x_val = 0
		let y_val = 0
		let z_val = 0
		let location_map = []

		// Structures
		for(var x = 0; x < steps; x++) {

			x_val = centerX + radius * Math.cos(2 * Math.PI * x / steps);
			z_val = centerY + radius * Math.sin(2 * Math.PI * x / steps);
			y_val = Math.floor(Math.random() * 4) + 1
			for (let obj of this.resources[x]) {
				obj.scale.multiplyScalar(0.01);
				obj.rotateX(Math.floor(Math.random() * 90) + 1 )
				obj.rotateY(Math.floor(Math.random() * 90) + 1 )
				obj.rotateZ(Math.floor(Math.random() * 90) + 1 )
				obj.position = new RC.Vector3(x_val, y_val, z_val);
				obj.material.shininess = 16;
				obj.material = this.createTextureForStructures();

				let bp_x = obj.position.x + obj.geometry.boundingSphere.center.x * obj.scale.x
				let bp_y = obj.position.y + obj.geometry.boundingSphere.center.y * obj.scale.y
				let bp_z = obj.position.z + obj.geometry.boundingSphere.center.z * obj.scale.z
				let bp_radius = obj.geometry.boundingSphere.radius * obj.scale.x

				let pos = [bp_x,bp_y,bp_z,bp_radius]
				let highest_offset_radius = 0

				for (var location of location_map) {
					if (this.intersectCollision(location,pos) < 0) {
						if ((this.intersectCollision(location,pos)) < highest_offset_radius) {
							highest_offset_radius = this.intersectCollision(location,pos)
						}
					}
				}
				highest_offset_radius = Math.abs(highest_offset_radius)

				obj.positionX += highest_offset_radius
				obj.positionY += highest_offset_radius
				obj.positionZ += highest_offset_radius
				let new_pos = [bp_x+highest_offset_radius,bp_y+highest_offset_radius,bp_z+highest_offset_radius,bp_radius]
				location_map.push(new_pos)

				this.scene.add(obj);

			}
		}
	}

	setupObjectsInHemiSphere() {

		let num_points = this.augmented_three_d_model_count
		let indices = [...Array(num_points).keys()]
		let phi = 0
		let theta = 0
		let x_val = 0
		let y_val = 0
		let z_val = 0
		let radius = 3
		let radius_scalar = 2
		let radius_outset_scalar = 1.25
		let redius_inset_scalar = 0.5
		let redius_inv_inset_scalar = 0.3
		let location_map = []

		for(var x = 0; x < num_points; x++) {
			// Intersect Flag
			let isIntersectFlag = false

			// Sphere coordinates
			indices[x] = indices[x] + 0.5
			phi = Math.acos(1 - 2*indices[x]/num_points)
			theta = Math.PI * (1 + 5**0.5) * indices[x]

			// Select the upper hemisphere
			if (Math.sin(theta) * Math.sin(phi) > 0) {
				x_val = Math.cos(theta) * Math.sin(phi)*radius
				y_val = Math.sin(theta) * Math.sin(phi)*radius
				z_val = Math.cos(phi)*radius
				for (let obj of this.resources[x]) {
					obj.scale.multiplyScalar(0.01);

					// Stochastic Rotation
					obj.rotateX(Math.floor(Math.random() * 90) + 1 )
					obj.rotateY(Math.floor(Math.random() * 90) + 1 )
					obj.rotateZ(Math.floor(Math.random() * 90) + 1 )

					// Initial Position
					obj.position = new RC.Vector3(x_val, y_val, z_val);
					obj.material.shininess = 16;
					obj.material = this.createTextureForStructures();

					// Collision Detection
					let bp_x = obj.position.x + obj.geometry.boundingSphere.center.x * obj.scale.x
					let bp_y = obj.position.y + obj.geometry.boundingSphere.center.y * obj.scale.y
					let bp_z = obj.position.z + obj.geometry.boundingSphere.center.z * obj.scale.z
					let bp_radius = obj.geometry.boundingSphere.radius * obj.scale.x
					let pos = [bp_x,bp_y,bp_z,bp_radius]
					let highest_offset_radius = 0

					for (var location of location_map) {
						if (this.intersectCollision(location,pos) < 0) {
							if ((this.intersectCollision(location,pos)) < highest_offset_radius) {
								isIntersectFlag = true
								highest_offset_radius = this.intersectCollision(location,pos)
							}
						}
					}

					// Collision Mitigation
					highest_offset_radius = Math.abs(highest_offset_radius)
					obj.positionX -= highest_offset_radius
					obj.positionY -= highest_offset_radius
					obj.positionZ -= highest_offset_radius
					let new_pos = [bp_x-highest_offset_radius,bp_y-highest_offset_radius,bp_z-highest_offset_radius,bp_radius]
					location_map.push(new_pos)

					// Outset
					if (!isIntersectFlag) {
						let outset_clone = new RC.Mesh(obj.geometry, this.createTextureForStructures());
						outset_clone.material.shininess = 16;
						outset_clone.scale.multiplyScalar(0.01);
						outset_clone.position = new RC.Vector3(x_val * radius_outset_scalar, y_val * radius_outset_scalar, z_val * radius_outset_scalar);
						// Stochastic Rotation
						outset_clone.rotateX(Math.floor(Math.random() * 90) + 1 )
						outset_clone.rotateY(Math.floor(Math.random() * 90) + 1 )
						outset_clone.rotateZ(Math.floor(Math.random() * 90) + 1 )

						location_map.push([x_val * radius_outset_scalar, y_val * radius_outset_scalar, z_val * radius_outset_scalar])
						this.scene.add(outset_clone)
					}
					// Inset
					if (!isIntersectFlag) {
						let outset_clone = new RC.Mesh(obj.geometry, this.createTextureForStructures());
						outset_clone.material.shininess = 1;
						outset_clone.scale.multiplyScalar(0.005);
						outset_clone.position = new RC.Vector3(x_val * redius_inset_scalar, y_val * redius_inset_scalar, z_val * redius_inset_scalar);
						// Stochastic Rotation
						outset_clone.rotateX(Math.floor(Math.random() * 90) + 1 )
						outset_clone.rotateY(Math.floor(Math.random() * 90) + 1 )
						outset_clone.rotateZ(Math.floor(Math.random() * 90) + 1 )

						location_map.push([x_val * redius_inset_scalar, y_val * redius_inset_scalar, z_val * redius_inset_scalar])
						this.scene.add(outset_clone)
					}

					this.scene.add(obj);
				}
			}
			// Select lower Hemisphere
			else {
				x_val = Math.cos(theta) * Math.sin(phi) * radius * -1 * radius_scalar
				y_val = Math.sin(theta) * Math.sin(phi) * radius * -1 * radius_scalar
				z_val = Math.cos(phi) * radius * -1 * radius_scalar
				for (let obj of this.resources[x]) {
					obj.scale.multiplyScalar(0.01);

					// Stochastic Rotation
					obj.rotateX(Math.floor(Math.random() * 90) + 1 )
					obj.rotateY(Math.floor(Math.random() * 90) + 1 )
					obj.rotateZ(Math.floor(Math.random() * 90) + 1 )

					// Initial Position
					obj.position = new RC.Vector3(x_val, y_val, z_val);
					obj.material.shininess = 16;
					obj.material = this.createTextureForStructures();

					// Collision Detection
					let bp_x = obj.position.x + obj.geometry.boundingSphere.center.x * obj.scale.x
					let bp_y = obj.position.y + obj.geometry.boundingSphere.center.y * obj.scale.y
					let bp_z = obj.position.z + obj.geometry.boundingSphere.center.z * obj.scale.z
					let bp_radius = obj.geometry.boundingSphere.radius * obj.scale.x
					let pos = [bp_x,bp_y,bp_z,bp_radius]
					let highest_offset_radius = 0

					for (var location of location_map) {
						if (this.intersectCollision(location,pos) < 0) {
							if ((this.intersectCollision(location,pos)) < highest_offset_radius) {
								isIntersectFlag = true
								highest_offset_radius = this.intersectCollision(location,pos)
							}
						}
					}

					// Collision Mitigation
					highest_offset_radius = Math.abs(highest_offset_radius)
					obj.positionX -= highest_offset_radius
					obj.positionY -= highest_offset_radius
					obj.positionZ -= highest_offset_radius
					let new_pos = [bp_x-highest_offset_radius,bp_y-highest_offset_radius,bp_z-highest_offset_radius,bp_radius]
					location_map.push(new_pos)

					// Outset
					if (!isIntersectFlag) {
						let outset_clone = new RC.Mesh(obj.geometry, this.createTextureForStructures());
						outset_clone.material.shininess = 1;
						outset_clone.scale.multiplyScalar(0.01);
						outset_clone.position = new RC.Vector3(x_val * radius_outset_scalar, y_val * radius_outset_scalar, z_val * radius_outset_scalar);
						// Stochastic Rotation
						outset_clone.rotateX(Math.floor(Math.random() * 90) + 1 )
						outset_clone.rotateY(Math.floor(Math.random() * 90) + 1 )
						outset_clone.rotateZ(Math.floor(Math.random() * 90) + 1 )

						location_map.push([x_val * radius_outset_scalar, y_val * radius_outset_scalar, z_val * radius_outset_scalar])
						this.scene.add(outset_clone)
					}

					// Inset
					if (!isIntersectFlag) {
						let outset_clone = new RC.Mesh(obj.geometry, this.createTextureForStructures());
						outset_clone.material.shininess = 1;
						outset_clone.scale.multiplyScalar(0.005);
						outset_clone.position = new RC.Vector3(x_val * redius_inv_inset_scalar, y_val * redius_inv_inset_scalar, z_val * redius_inv_inset_scalar);
						// Stochastic Rotation
						outset_clone.rotateX(Math.floor(Math.random() * 90) + 1 )
						outset_clone.rotateY(Math.floor(Math.random() * 90) + 1 )
						outset_clone.rotateZ(Math.floor(Math.random() * 90) + 1 )

						location_map.push([x_val * redius_inv_inset_scalar, y_val * redius_inv_inset_scalar, z_val * redius_inv_inset_scalar])
						this.scene.add(outset_clone)
					}

					this.scene.add(obj);
				}
			}
		}
	}


	/* ================== Most of my work here ================== */

	// In Main Constructor
	start() {
		// Add shadow maps to objects
		this.sceneObjects = []
		this.scene.traverse((object) => {
			if (object instanceof RC.Mesh) {
				if (object.material.programName === "custom_phong_liquid") {
					object.material.addSBValue("NUM_FRUSTUM_LIGHTS", this.lights.frustum.length);

					// Hack to use both shadow maps and normal textures
					let maps = object.material.maps.slice(); // Use slice() to copy by value, not by reference
					object.material.clearMaps();
					
					// Add shadow maps
					for (let l of this.lights.frustum)
						object.material.addMap(l.texture);

					// Continue the hack
					for (let m of maps)
						object.material.addMap(m);
				}

				let mat = new RC.CustomShaderMaterial("shadow_map");
				mat.lights = false;
				mat.side = object.material.side;
				// // To prevent Peter Panning
				// switch (object.material.side) {
				// 	case RC.FRONT_SIDE: mat.side = RC.BACK_SIDE; break;
				// 	case RC.BACK_SIDE: mat.side = RC.FRONT_SIDE; break;
				// 	default: mat.side = object.material.side; break;
				// }
				object.material_temp = mat;
				object.material_main = object.material;
				this.sceneObjects.push(object);
			}
		});

		// Begin animation
		window.requestAnimationFrame(() => { this.update(); });
	}

	// In Start method
	update() {
		// Timer
		this.timer.prev = this.timer.curr;
		this.timer.curr = performance.now() * 0.001;
		this.timer.delta = this.timer.curr - this.timer.prev;

		// FPS
		++this.fpsCount;
		if (this.timer.curr - this.fpsTime >= 1.0) {
			const fps = this.fpsCount / (this.timer.curr - this.fpsTime);
			document.getElementById("fps").innerHTML = Math.round(fps).toString();

			this.fpsCount = 0;
			this.fpsTime = this.timer.curr;
		}

		// DOF
		if (this.timer.curr - this.dof.lastUpdate >= 0.5) {
			if (this.renderQueue._textureMap.mainDepthDist !== undefined) {
				// Get the depth camera is looking at
				if (this.fboDepth === undefined) {
					this.fboDepth = this.gl.createFramebuffer();
					this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fboDepth);
					
					let texture = this.renderer._glManager._textureManager._cached_textures.get(this.renderQueue._textureMap.mainDepthDist);
					this.gl.framebufferTexture2D(
						this.gl.FRAMEBUFFER, this.gl.COLOR_ATTACHMENT0,
						this.gl.TEXTURE_2D, texture, 0
					);
					// Check if you can read from this type of texture.
					let canRead = (this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER) == this.gl.FRAMEBUFFER_COMPLETE);
					if (!canRead)
						throw "Unable to read depth framebuffer!";
				} else {
					this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fboDepth);
				}

				let pixel = new Float32Array(4);
				this.gl.readPixels(this.dof.focus.x, this.dof.focus.y, 1, 1, this.gl.RGBA, this.gl.FLOAT, pixel);
				// Unbind the framebuffer
				this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);

				this.dof.v0_target = Math.max(Math.min(pixel[0], this.dof.f * 0.9), 0.0);
				this.dof.lastUpdate = this.timer.curr;
			}
		}
		let diff = this.dof.v0 - this.dof.v0_target;
		if (Math.abs(diff) > 0.00001);
			this.dof.v0 -= diff * Math.min(this.timer.delta * 2.0, 1.0);

		currTime = new Date();
		delta_time = (prevTime !== -1) ? currTime - prevTime : 0;
		prevTime = currTime;

		keyboardTranslation.reset();
		keyboardRotation.reset();

		// Camera
		const input = {
			keyboard: this.keyboardInput.update(),
			navigators: {
				rotation: {x: 0, y: 0, z: 0},
				translation: {x: 0, y: 0, z: 0}
			},
			mouse: this.mouseInput.update(),
			gamepads: undefined,
			multiplier: 1
		};

		const motion_scalar = 0.001
		const translation_motion_damping = 1
		const rotation_motion_damping = 1

		this.camera.translateX(keyboardTranslation.x * delta_time * motion_scalar * translation_motion_damping);
		this.camera.translateY(keyboardTranslation.y * delta_time * motion_scalar * translation_motion_damping);
		this.camera.translateZ(keyboardTranslation.z * delta_time * motion_scalar * translation_motion_damping);
		this.camera.rotationX += keyboardRotation.x * delta_time * motion_scalar * rotation_motion_damping;
		this.camera.rotationY += keyboardRotation.y  * delta_time * motion_scalar * rotation_motion_damping;
		this.camera.rotationZ += keyboardRotation.z * delta_time * motion_scalar * rotation_motion_damping;

		this.cameraManager.update(input, this.timer.delta * 1000);

		// Move light
		this.lights.frustum[0].camera.position.x = -6 + 3 * Math.sin(this.timer.curr * 0.5);
		this.lights.frustum[0].camera.lookAt(new RC.Vector3(0, 0, 0), new RC.Vector3(0, 1, 0));

		//Floating animation
		for (let i = 2; i < this.sceneObjects.length; i++) {
			var floating_coefficient = this.list_floating_motion[i%this.list_floating_motion.length]
			this.sceneObjects[i].positionY += 0.0005*(-2.5 * Math.atan((-0.4 * Math.sin(0.3 * this.timer.curr + floating_coefficient))/(1+ 0.4 * Math.cos(0.2 * this.timer.curr + floating_coefficient))));
			this.sceneObjects[i].positionX += 0.0005*(-2.5 * Math.atan((-0.4 * Math.sin(0.3 * this.timer.curr + floating_coefficient))/(1+ 0.4 * Math.cos(0.2 * this.timer.curr + floating_coefficient))));
			this.sceneObjects[i].positionZ += 0.0005*(-2.5 * Math.atan((-0.4 * Math.sin(0.3 * this.timer.curr + floating_coefficient))/(1+ 0.4 * Math.cos(0.2 * this.timer.curr + floating_coefficient))));
		}

		// Render
		this.render();
		window.requestAnimationFrame(() => { this.update(); });
	}

	// In Update method
	render() {
		// For some reason I have to manually do this?????
		this.camera.updateMatrixWorld();
		this.camera.matrixWorldInverse.getInverse(this.camera.matrixWorld);

		// So RenderCore doesn't spam the console when loading shaders
		if (this.renderer._loadRequiredPrograms()) {

			this.renderQueue.render();

			if (this.renderer.succeeded) {
				this.setLoading(false);

				if (this.airlightLookupRendered === undefined) {
					this.renderQueue.removeRenderPass(this.airlightLookupPass);
					this.airlightLookupRendered = true;
				}

				// Swap WebGL textures
				let glmap = this.renderer._glManager._textureManager._cached_textures;
				let tex1 = glmap.get(this.particles.texture[0]);
				let tex2 = glmap.get(this.particles.texture[1]);
				glmap.set(this.particles.texture[0], tex2);
				glmap.set(this.particles.texture[1], tex1);

				// // Swap RenderCore textures
				// let map = this.renderQueue._textureMap;
				// let temp = map.particlesRead;
				// map.particlesRead = map.particlesWrite;
				// map.particlesWrite = temp;
			} else {
				this.setLoading(true);
			}

		}
	}

	// In Render method
	resize() {
		// Resize canvas
		this.canvas.width  = window.innerWidth;
		this.canvas.height = window.innerHeight;
	
		// Update aspect ratio and viewport
		this.camera.aspect = this.canvas.width / this.canvas.height;
		this.PMatInv.getInverse(this.camera.projectionMatrix);
		this.renderer.updateViewport(this.canvas.width, this.canvas.height);

		// Update render passes
		this.perlinNoisePass.viewport = { width: this.canvas.width, height: this.canvas.height };
		this.mainRenderPass.viewport = { width: this.canvas.width, height: this.canvas.height };
		this.depthPass.viewport = { width: this.canvas.width, height: this.canvas.height };

		for (let pass of this.lightVolumePasses)
			pass.viewport = { width: this.canvas.width, height: this.canvas.height };
		this.lightVolumePass.viewport = { width: this.canvas.width, height: this.canvas.height };

		this.dofDownsamplePass.viewport = { width: this.canvas.width * 0.25, height: this.canvas.height * 0.25 };
		for (let i = 0; i < this.dof.numPasses; ++i) {
			this.gaussPassHor[i].viewport = { width: this.canvas.width * 0.25, height: this.canvas.height * 0.25 };
			this.gaussPassVert[i].viewport = { width: this.canvas.width * 0.25, height: this.canvas.height * 0.25 };
		}
		this.cocPass.viewport = { width: this.canvas.width * 0.25, height: this.canvas.height * 0.25 };
		this.dofSmallBlurPass.viewport = { width: this.canvas.width * 0.25, height: this.canvas.height * 0.25 };
		this.dofPass.viewport = { width: this.canvas.width, height: this.canvas.height };

		this.waterRenderPass.viewport = { width: this.canvas.width, height: this.canvas.height };
		this.particleDrawPass.viewport = { width: this.canvas.width, height: this.canvas.height };

		this.postPass.viewport = { width: this.canvas.width, height: this.canvas.height };

		this.displayPass.viewport = { width: this.canvas.width, height: this.canvas.height };
		
		// DOF focus
		this.dof.focus.x = Math.trunc(this.canvas.width / 2.0);
		this.dof.focus.y = Math.trunc(this.canvas.height / 2.0);
	}

	// Loading message
	setLoading(isLoading) {
		if (isLoading !== this.isLoading) {
			document.getElementById("loading").style.display = isLoading ? "block" : "none";
			this.isLoading = isLoading;
		}
	}
}


document.addEventListener("DOMContentLoaded", () => {
	const canvas = document.getElementById("canvas");
	const app = new App(canvas);
});
