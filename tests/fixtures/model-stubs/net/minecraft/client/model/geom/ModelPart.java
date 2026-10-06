package net.minecraft.client.model.geom;

import java.util.List;
import java.util.Map;
import org.joml.Vector3f;

public final class ModelPart {
    public float x, y, z, xRot, yRot, zRot;
    public float xScale = 1, yScale = 1, zScale = 1;
    public boolean visible = true;
    private final List<Cube> cubes;
    private final Map<String, ModelPart> children;

    public ModelPart(List<Cube> cubes, Map<String, ModelPart> children) {
        this.cubes = cubes;
        this.children = children;
    }

    public static class Cube {
        public final Polygon[] polygons;

        public Cube(Polygon[] polygons) {
            this.polygons = polygons;
        }
    }

    public record Polygon(Vertex[] vertices, Vector3f normal) {}

    public record Vertex(Vector3f pos, float u, float v) {}
}
