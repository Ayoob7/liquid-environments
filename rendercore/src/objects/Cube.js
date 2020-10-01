/**
 * Created by Primoz on 29. 11. 2016.
 */

import {Mesh} from './Mesh.js';
import {Float32Attribute, Uint32Attribute} from '../core/BufferAttribute.js';
import {Geometry} from './Geometry.js';

import {MeshBasicMaterial} from '../materials/MeshBasicMaterial.js';

export class Cube extends Mesh {
	constructor(scale, color) {

		var geometry = new Geometry();
		var material = new MeshBasicMaterial();
		material.color = color;

		// Quad vertices
		geometry.vertices = Float32Attribute([
			// Front face
			-1.0, -1.0,  1.0,
			1.0, -1.0,  1.0,
			1.0,  1.0,  1.0,
			-1.0,  1.0,  1.0,

			// Back face
			-1.0, -1.0, -1.0,
			-1.0,  1.0, -1.0,
			1.0,  1.0, -1.0,
			1.0, -1.0, -1.0,

			// Top face
			-1.0,  1.0, -1.0,
			-1.0,  1.0,  1.0,
			1.0,  1.0,  1.0,
			1.0,  1.0, -1.0,

			// Bottom face
			-1.0, -1.0, -1.0,
			1.0, -1.0, -1.0,
			1.0, -1.0,  1.0,
			-1.0, -1.0,  1.0,

			// Right face
			1.0, -1.0, -1.0,
			1.0,  1.0, -1.0,
			1.0,  1.0,  1.0,
			1.0, -1.0,  1.0,

			// Left face
			-1.0, -1.0, -1.0,
			-1.0, -1.0,  1.0,
			-1.0,  1.0,  1.0,
			-1.0,  1.0, -1.0
		], 3);

		for (let i = 0; i < geometry.vertices.array.length; i++) {
			geometry.vertices.array[i] *= scale;
		}

		geometry.indices = Uint32Attribute([
			0, 1, 2,      0, 2, 3,    // Front face
			4, 5, 6,      4, 6, 7,    // Back face
			8, 9, 10,     8, 10, 11,  // Top face
			12, 13, 14,   12, 14, 15, // Bottom face
			16, 17, 18,   16, 18, 19, // Right face
			20, 21, 22,   20, 22, 23  // Left face
		], 1);

		geometry.computeVertexNormals();



		// Super Mesh
		super(geometry, material);

		this.type = "Cube";
	}
};