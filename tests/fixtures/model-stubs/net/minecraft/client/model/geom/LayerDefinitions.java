package net.minecraft.client.model.geom;

import java.util.*;
import net.minecraft.client.model.geom.builders.LayerDefinition;
import net.minecraft.client.model.geom.builders.MaterialDefinition;
import org.joml.Vector3f;

public class LayerDefinitions {
    public static Map<ModelLayerLocation, LayerDefinition> createRoots() {
        Map<ModelLayerLocation, LayerDefinition> m = new HashMap<>();
        m.put(new ModelLayerLocation("minecraft:test_mob", "main"), new LayerDefinition(new MaterialDefinition(64, 32), () -> {
            ModelPart.Vertex[] vs = {
                new ModelPart.Vertex(new Vector3f(-4, -8, -4), 0.125f, 0.25f),
                new ModelPart.Vertex(new Vector3f(4, -8, -4), 0.25f, 0.25f),
                new ModelPart.Vertex(new Vector3f(4, 0, -4), 0.25f, 0.5f),
                new ModelPart.Vertex(new Vector3f(-4, 0, -4), 0.125f, 0.5f)
            };
            ModelPart.Cube cube = new ModelPart.Cube(new ModelPart.Polygon[] { new ModelPart.Polygon(vs, new Vector3f(0, 0, -1)) });
            ModelPart head = new ModelPart(List.of(cube), new LinkedHashMap<>());
            head.y = 6;
            head.xRot = 0.5f;
            Map<String, ModelPart> kids = new LinkedHashMap<>();
            kids.put("head", head);
            return new ModelPart(List.of(), kids);
        }));
        m.put(new ModelLayerLocation("minecraft:broken", "main"), new LayerDefinition(new MaterialDefinition(16, 16), () -> {
            throw new IllegalStateException("needs a render system");
        }));
        m.put(new ModelLayerLocation("minecraft:creeper", "main"), new LayerDefinition(new MaterialDefinition(64, 32), () -> {
            Map<String, ModelPart> kids = new LinkedHashMap<>();
            kids.put("head", part(0, 6, 0, box(-4, -8, -4, 8, 8, 8, 0, 0)));
            kids.put("body", part(0, 6, 0, box(-4, 0, -2, 8, 12, 4, 16, 16)));
            kids.put("right_hind_leg", part(-2, 18, 4, box(-2, 0, -2, 4, 6, 4, 0, 16)));
            kids.put("left_hind_leg", part(2, 18, 4, box(-2, 0, -2, 4, 6, 4, 0, 16)));
            kids.put("right_front_leg", part(-2, 18, -4, box(-2, 0, -2, 4, 6, 4, 0, 16)));
            kids.put("left_front_leg", part(2, 18, -4, box(-2, 0, -2, 4, 6, 4, 0, 16)));
            return new ModelPart(List.of(), kids);
        }));
        return m;
    }

    private static ModelPart part(float x, float y, float z, ModelPart.Cube cube) {
        ModelPart p = new ModelPart(List.of(cube), new LinkedHashMap<>());
        p.x = x;
        p.y = y;
        p.z = z;
        return p;
    }

    private static ModelPart.Vertex vx(float x, float y, float z) {
        return new ModelPart.Vertex(new Vector3f(x, y, z), 0, 0);
    }

    private static ModelPart.Polygon poly(ModelPart.Vertex[] v, float u1, float v1, float u2, float v2, Vector3f n) {
        float W = 64, H = 32;
        ModelPart.Vertex[] out = {
            new ModelPart.Vertex(v[0].pos(), u2 / W, v1 / H),
            new ModelPart.Vertex(v[1].pos(), u1 / W, v1 / H),
            new ModelPart.Vertex(v[2].pos(), u1 / W, v2 / H),
            new ModelPart.Vertex(v[3].pos(), u2 / W, v2 / H)
        };
        return new ModelPart.Polygon(out, n);
    }

    /** Same corner/UV layout as vanilla ModelPart.Cube. */
    private static ModelPart.Cube box(float x, float y, float z, float w, float h, float d, float u, float v) {
        float f = x, g = y, hh = z, i = x + w, j = y + h, k = z + d;
        ModelPart.Vertex a = vx(f, g, hh), b = vx(i, g, hh), c = vx(i, j, hh), e = vx(f, j, hh);
        ModelPart.Vertex a2 = vx(f, g, k), b2 = vx(i, g, k), c2 = vx(i, j, k), e2 = vx(f, j, k);
        float l = u, mm = u + d, n = u + d + w, o = u + d + w + w, p = u + d + w + d, q = u + d + w + d + w;
        float r = v, s = v + d, t = v + d + h;
        return new ModelPart.Cube(new ModelPart.Polygon[] {
            poly(new ModelPart.Vertex[] { b2, a2, a, b }, mm, r, n, s, new Vector3f(0, -1, 0)),
            poly(new ModelPart.Vertex[] { c, e, e2, c2 }, n, s, o, r, new Vector3f(0, 1, 0)),
            poly(new ModelPart.Vertex[] { a, a2, e2, e }, l, s, mm, t, new Vector3f(-1, 0, 0)),
            poly(new ModelPart.Vertex[] { b, a, e, c }, mm, s, n, t, new Vector3f(0, 0, -1)),
            poly(new ModelPart.Vertex[] { b2, b, c, c2 }, n, s, p, t, new Vector3f(1, 0, 0)),
            poly(new ModelPart.Vertex[] { a2, b2, c2, e2 }, p, s, q, t, new Vector3f(0, 0, 1))
        });
    }
}
