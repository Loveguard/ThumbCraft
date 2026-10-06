package net.minecraft.client.model.geom;

public record ModelLayerLocation(String model, String layer) {
    @Override
    public String toString() {
        return model + "#" + layer;
    }
}
