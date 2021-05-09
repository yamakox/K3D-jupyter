//jshint maxstatements:false,maxcomplexity:false

'use strict';

var THREE = require('three'),
    _ = require('./../../../lodash'),
    colorMapHelper = require('./../../../core/lib/helpers/colorMap'),
    typedArrayToThree = require('./../helpers/Fn').typedArrayToThree,
    areAllChangesResolve = require('./../helpers/Fn').areAllChangesResolve,
    commonUpdate = require('./../helpers/Fn').commonUpdate;

/**
 * Loader strategy to handle Volume object
 * @method MultiMIP
 * @memberof K3D.Providers.ThreeJS.Objects
 * @param {Object} config all configurations params from JSON
 * @param {K3D}
 * @return {Object} 3D object ready to render
 */
module.exports = {
    create: function (config) {
        config.samples = config.samples || 512.0;
        config.gradient_step = config.gradient_step || 0.005;

        var number = config.volume_list.length;
        var geometry = new THREE.BoxBufferGeometry(1, 1, 1),
            modelMatrix = new THREE.Matrix4(),
            translation = new THREE.Vector3(),
            rotation = new THREE.Quaternion(),
            scale = new THREE.Vector3(),
            colorMap = config.color_map_list,
            opacityFunction = config.opacity_function_list,
            colorRange = config.color_range_list,
            samples = config.samples,
            alpha_blending = config.alpha_blending,
            object,
            texture = [],
            colormap = [],
            jitterTexture;

        modelMatrix.set.apply(modelMatrix, config.model_matrix.data);
        modelMatrix.decompose(translation, rotation, scale);

        for( var i = 0; i < number; i++ ) {
            var texture_ = new THREE.DataTexture3D(
                config.volume_list[i].data,
                config.volume_list[i].shape[2],
                config.volume_list[i].shape[1],
                config.volume_list[i].shape[0]);
            
            texture_.format = THREE.RedFormat;
            texture_.type = typedArrayToThree(config.volume_list[i].data.constructor);
            
            texture_.generateMipmaps = false;
            texture_.minFilter = THREE.LinearFilter;
            texture_.magFilter = THREE.LinearFilter;
            texture_.wrapS = texture_.wrapT = THREE.ClampToEdgeWrapping;
            texture_.needsUpdate = true;
            
            texture.push(texture_);
        }

        jitterTexture = new THREE.DataTexture(
            new Uint8Array(_.range(64 * 64).map(function () {
                return 255.0 * Math.random();
            })),
            64, 64, THREE.RedFormat, THREE.UnsignedByteType);
        jitterTexture.minFilter = THREE.LinearFilter;
        jitterTexture.magFilter = THREE.LinearFilter;
        jitterTexture.wrapS = jitterTexture.wrapT = THREE.MirroredRepeatWrapping;
        jitterTexture.generateMipmaps = false;
        jitterTexture.needsUpdate = true;

        for( var i = 0; i < number; i++ ) {
            var canvas = colorMapHelper.createCanvasGradient(colorMap[i].data, 1024, opacityFunction[i].data);
            var colormap_ = new THREE.CanvasTexture(canvas, THREE.UVMapping, THREE.ClampToEdgeWrapping,
                THREE.ClampToEdgeWrapping, THREE.NearestFilter, THREE.NearestFilter);
            colormap_.needsUpdate = true;
            colormap.push(colormap_);
        }

        var uniforms = {
            number: {value: number},
            gradient_step: {value: config.gradient_step},
            samples: {value: samples},
            alpha_blending: {value: alpha_blending},
            translation: {value: translation},
            rotation: {value: rotation},
            scale: {value: scale},
            jitterTexture: {type: 't', value: jitterTexture}
        };
        for( var i = 0; i < number; i++ ) {
            uniforms['volumeTexture'+i] = {type: 't', value: texture[i]};
            uniforms['colormap'+i] = {type: 't', value: colormap[i]};
            uniforms['low'+i] = {value: colorRange[i][0]};
            uniforms['high'+i] = {value: colorRange[i][1]};
        }
        for( var i = number; i < 4; i++ ) {
            uniforms['volumeTexture'+i] = {type: 't', value: new THREE.DataTexture3D()};
            uniforms['colormap'+i] = {type: 't', value: new THREE.Texture()};
            uniforms['low'+i] = {value: 0.0};
            uniforms['high'+i] = {value: 1.0};
        }

        var material = new THREE.ShaderMaterial({
            uniforms: _.merge(
                uniforms,
                THREE.UniformsLib.lights
            ),
            defines: {
                USE_SPECULAR: 0
            },
            vertexShader: require('./shaders/MultiMIP.vertex.glsl'),
            fragmentShader: require('./shaders/MultiMIP.fragment.glsl'),
            side: THREE.BackSide,
            depthTest: false,
            depthWrite: false,
            lights: false,
            clipping: true,
            transparent: true
        });

        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();

        object = new THREE.Mesh(geometry, material);
        object.applyMatrix4(modelMatrix);
        object.updateMatrixWorld();

        object.onRemove = function () {
            for(var i = 0; i < 4; i++) {
                object.material.uniforms['volumeTexture'+i].value.dispose();
                object.material.uniforms['volumeTexture'+i].value = undefined;
                object.material.uniforms['colormap'+i].value.dispose();
                object.material.uniforms['colormap'+i].value = undefined;
            }
            jitterTexture.dispose();
            jitterTexture = undefined;
        };

        return Promise.resolve(object);
    },

    // @TODO: create同様にvolume, color_map, opacity_function, color_rangeのリスト化対応が必要。
    update: function (config, changes, obj) {
        var resolvedChanges = {};

        if (typeof(changes.color_range) !== 'undefined' && !changes.color_range.timeSeries) {
            obj.material.uniforms.low.value = changes.color_range[0];
            obj.material.uniforms.high.value = changes.color_range[1];

            resolvedChanges.color_range = null;
        }


        if (typeof(changes.volume) !== 'undefined' && !changes.volume.timeSeries) {
            if (obj.material.uniforms.volumeTexture.value.image.data.constructor === changes.volume.data.constructor) {
                obj.material.uniforms.volumeTexture.value.image.data = changes.volume.data;
                obj.material.uniforms.volumeTexture.value.needsUpdate = true;

                resolvedChanges.volume = null;
            }
        }

        if ((typeof(changes.color_map) !== 'undefined' && !changes.color_map.timeSeries) ||
            (typeof(changes.opacity_function) !== 'undefined' && !changes.opacity_function.timeSeries)) {

            var canvas = colorMapHelper.createCanvasGradient(
                (changes.color_map && changes.color_map.data) || config.color_map.data,
                1024,
                (changes.opacity_function && changes.opacity_function.data) || config.opacity_function.data
            );

            obj.material.uniforms.colormap.value.image = canvas;
            obj.material.uniforms.colormap.value.needsUpdate = true;

            resolvedChanges.color_map = null;
            resolvedChanges.opacity_function = null;
        }

        ['samples', 'gradient_step'].forEach(function (key) {
            if (changes[key] && !changes[key].timeSeries) {
                obj.material.uniforms[key].value = changes[key];
                resolvedChanges[key] = null;
            }
        });

        commonUpdate(config, changes, resolvedChanges, obj);

        if (areAllChangesResolve(changes, resolvedChanges)) {
            return Promise.resolve({json: config, obj: obj});
        } else {
            return false;
        }
    }
};
